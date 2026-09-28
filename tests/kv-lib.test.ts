// KV 记录接口 _lib.js 纯函数测试（buildStats / sortRecords / buildIndex / purge 过滤 / 共享限流 / 孤儿路径归一化）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildStats,
  sortRecords,
  buildIndex,
  isRateLimited,
  cnbImgPathOf,
  normalizeAssetPath,
  readIndex,
  writeIndex,
  INDEX_SAFE_LIMIT_BYTES,
  INDEX_SHARD_PREFIX,
} from '../functions/image-records/_lib.js'
import { onRequest } from '../functions/image-records/index.js'

const now = Date.now()
const records = [
  { id: 'a', name: 'b.webp', url: 'u1', size: 100, type: 'image/webp', createdAt: now - 1000 },
  { id: 'b', name: 'a.png', url: 'u2', size: 500, type: 'image/png', createdAt: now },
  { id: 'c', name: 'c.gif', url: 'u3', size: 300, type: 'image/gif', createdAt: now - 500, deletedAt: now - 100 },
]

describe('buildStats', () => {
  it('统计排除软删除记录，trashed 单独计数', () => {
    const s = buildStats(records)
    expect(s.count).toBe(2)
    expect(s.totalSize).toBe(600)
    expect(s.trashed).toBe(1)
    expect(s.byType).toEqual({ webp: 1, png: 1 })
  })

  it('trashedSize 汇总软删除记录体积（原图仍占用 CNB 存储）', () => {
    const s = buildStats(records)
    expect(s.trashedSize).toBe(300)
    expect(buildStats(records.filter((r) => !r.deletedAt)).trashedSize).toBe(0)
  })

  it('todayCount 只统计当天创建的记录', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 2)
    const old = [{ id: 'x', name: 'x', url: 'ux', size: 1, type: 'image/png', createdAt: yesterday.getTime() }]
    expect(buildStats(old).todayCount).toBe(0)
    expect(buildStats(old).count).toBe(1)
  })

  it('tz 参数：今日按调用方本地 0 点切分（边缘函数跑在 UTC，需前端传偏移量）', () => {
    vi.useFakeTimers()
    try {
      // 2026-09-28T00:30:00Z = 东八区 08:30；本地 0 点 = 2026-09-27T16:00Z
      vi.setSystemTime(new Date('2026-09-28T00:30:00Z'))
      // UTC 口径的"昨天 23:59"，对东八区用户是"今天 07:59"
      const localToday = new Date('2026-09-27T23:59:00Z').getTime()
      const daysAgo = new Date('2026-09-25T12:00:00Z').getTime()
      const recs = [
        { id: 'a', name: 'a', url: 'u', size: 1, type: 'image/png', createdAt: localToday },
        { id: 'b', name: 'b', url: 'u', size: 1, type: 'image/png', createdAt: daysAgo },
      ]
      expect(buildStats(recs, -480).todayCount).toBe(1)
      // 无 tz 回退"服务器本地时区 0 点"：与运行环境 new Date 的 0 点口径一致（边缘环境即 UTC）
      const serverMidnight = new Date()
      serverMidnight.setHours(0, 0, 0, 0)
      expect(buildStats(recs).todayCount).toBe(localToday >= serverMidnight.getTime() ? 1 : 0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sortRecords', () => {
  it('createdAt desc 最新在前', () => {
    expect(sortRecords(records, 'createdAt', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
  it('size asc 从小到大', () => {
    expect(sortRecords(records, 'size', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })
  it('name asc 中文按 localeCompare', () => {
    const zh = [
      { id: 'x', name: '香蕉', size: 1, createdAt: 1 },
      { id: 'y', name: '苹果', size: 1, createdAt: 1 },
    ]
    expect(sortRecords(zh, 'name', 'asc').map((r) => r.id)).toEqual(['y', 'x'])
  })
  it('不修改原数组', () => {
    const copy = [...records]
    sortRecords(records, 'size', 'asc')
    expect(records).toEqual(copy)
  })
})

describe('buildIndex', () => {
  it('按 createdAt 倒序生成精简索引，正常记录 deletedAt 为 undefined', () => {
    const idx = buildIndex(records)
    expect(idx.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    // 软删除记录保留 deletedAt 时间戳（回收站视图依赖）；正常记录该字段为 undefined
    // （JSON 序列化时 undefined 字段会被丢弃，与 KV 落盘行为一致）
    expect(idx[1].deletedAt).toBeTruthy()
    expect(idx[0].deletedAt).toBeUndefined()
  })
})

// 共享限流：内存为第一层快路径，IMG_RECORDS_KV 为跨实例权威计数层，KV 异常时降级内存
describe('isRateLimited（KV 共享限流）', () => {
  // 模拟 EdgeOne KV 的最小接口（get/put/delete）
  function makeFakeKV() {
    const store = new Map<string, string>()
    return {
      store,
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => store.set(k, String(v)),
      delete: async (k) => store.delete(k),
    }
  }
  let kv: ReturnType<typeof makeFakeKV> | null = null

  beforeEach(() => {
    kv = makeFakeKV()
    ;(globalThis as any).IMG_RECORDS_KV = kv
  })
  afterEach(() => {
    delete (globalThis as any).IMG_RECORDS_KV
    kv = null
  })

  it('计数写入 KV，达到上限后拒绝；键仅含 KV 允许的字符', async () => {
    const results = []
    for (let i = 0; i < 4; i++) results.push(await isRateLimited('write:1.2.3.4', 3))
    expect(results).toEqual([false, false, false, true])
    expect(kv!.store.size).toBe(1)
    const [key, value] = [...kv!.store.entries()][0]
    expect(key).toMatch(/^rl[a-zA-Z0-9_]+$/)
    expect(Number(value)).toBe(3)
  })

  it('KV 异常时降级为纯内存限流（仍生效）', async () => {
    ;(globalThis as any).IMG_RECORDS_KV = {
      get: async () => {
        throw new Error('kv down')
      },
      put: async () => {
        throw new Error('kv down')
      },
      delete: async () => {},
    }
    const results = []
    for (let i = 0; i < 4; i++) results.push(await isRateLimited('read:5.6.7.8', 3))
    expect(results).toEqual([false, false, false, true])
  })
})

describe('cnbImgPathOf / normalizeAssetPath（孤儿扫描路径归一化）', () => {
  it('记录 url：从 /api/img/ 代理链接提取 imgPath', () => {
    expect(cnbImgPathOf('https://img.example.com/api/img/2024/abc.png')).toBe('2024/abc.png')
  })
  it('记录 url：从原生 -/imgs/ 链接提取 imgPath', () => {
    expect(cnbImgPathOf('https://cnb.cool/u/r/-/imgs/a/b.png')).toBe('a/b.png')
  })
  it('无标记返回 null，空值安全', () => {
    expect(cnbImgPathOf('https://other.example.com/x.png')).toBeNull()
    expect(cnbImgPathOf('')).toBeNull()
    expect(cnbImgPathOf(undefined)).toBeNull()
  })
  it('平台资产 path：带 -/imgs/ 前缀时取后缀', () => {
    expect(normalizeAssetPath('user/repo/-/imgs/2024/x.webp')).toBe('2024/x.webp')
  })
  it('平台资产 path：裸路径直接返回并截断查询串', () => {
    expect(normalizeAssetPath('2024/x.webp?v=1')).toBe('2024/x.webp')
  })
  it('平台资产 path：空值返回 null', () => {
    expect(normalizeAssetPath('')).toBeNull()
    expect(normalizeAssetPath(null)).toBeNull()
  })
})

// ---------------------------------------------------------------- 接口集成测试
// 直接驱动 onRequest（无 SITE_PASSWORD 时鉴权恒通过），复现并锁定
// "批量上传返回成功但列表不可见"的索引丢失 bug 及其修复

function makeFakeKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    // 与平台 KV 一致：type: 'json' 时返回解析后的对象
    get: async (k: string, opts?: { type?: string }) => {
      const v = store.get(k)
      if (v === undefined || v === null) return null
      return opts?.type === 'json' ? JSON.parse(v) : v
    },
    put: async (k: string, v: string) => {
      store.set(k, String(v))
    },
    delete: async (k: string) => {
      store.delete(k)
    },
    list: async ({ prefix, cursor, limit }: { prefix?: string; cursor?: string; limit?: number } = {}) => {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix || '')).sort()
      let start = 0
      if (cursor) start = all.indexOf(cursor) + 1
      const page = all.slice(start, start + (limit || 256))
      return {
        keys: page.map((key) => ({ key })),
        complete: start + page.length >= all.length,
        cursor: page.at(-1)?.key,
      }
    },
  }
}

let kv: ReturnType<typeof makeFakeKV> | null = null

async function call(method: string, query = '', body?: unknown) {
  const res = await onRequest({
    request: new Request(`http://localhost/image-records${query}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env: {},
  })
  return { status: res.status, data: await res.json() }
}

function rec(id: string, minsAgo = 0) {
  return { id, name: `${id}.png`, url: `https://s.example/api/img/${id}.png`, size: 123, type: 'image/png', createdAt: Date.now() - minsAgo * 60000 }
}

// 构造超大的索引数组（每条约 700 字节，n=1500 时约 1MB，必定触发分片）
function makeBigIndex(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    name: 'x'.repeat(600),
    url: `https://s.example/api/img/f${i}.png`,
    size: 1,
    type: 'image/png',
    createdAt: i,
  }))
}

describe('image-records 接口集成（模拟 KV）', () => {
  beforeEach(() => {
    kv = makeFakeKV()
    ;(globalThis as any).IMG_RECORDS_KV = kv
  })
  afterEach(() => {
    delete (globalThis as any).IMG_RECORDS_KV
    kv = null
  })

  it('批量写入后新记录立即可见（核心回归：索引必须合并本次写入）', async () => {
    const r1 = rec('batch1', 1)
    const r2 = rec('batch2', 0)
    const post = await call('POST', '', { records: [r1, r2] })
    expect(post.status).toBe(200)
    expect(post.data.code).toBe(0)

    const get = await call('GET')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['batch2', 'batch1'])
    // 索引已落盘且包含两条
    const index = JSON.parse(kv!.store.get('image_records_index')!)
    expect(index.map((r: any) => r.id)).toEqual(['batch2', 'batch1'])
  })

  it('批量重试幂等：同一批重复提交不会产生重复条目', async () => {
    const r = rec('dup1')
    await call('POST', '', { records: [r] })
    await call('POST', '', { records: [r] })
    const get = await call('GET')
    expect(get.data.data).toHaveLength(1)
  })

  it('单条写入：索引缺失时也能创建并可见（不依赖全表扫描）', async () => {
    // list 故障（恒返回空）：旧逻辑在索引缺失时依赖扫描重建，记录会被埋掉
    ;(kv as any)!.list = async () => ({ keys: [], complete: true })
    const post = await call('POST', '', rec('solo1'))
    expect(post.data.code).toBe(0)
    const get = await call('GET')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['solo1'])
  })

  it('?rebuild=1 强制全表扫描重建：无索引的历史记录可复活', async () => {
    // 直接预置两条记录本体（模拟被埋掉的历史），不建索引
    kv!.store.set('image_old1', JSON.stringify(rec('old1', 5)))
    kv!.store.set('image_old2', JSON.stringify(rec('old2', 3)))
    const before = await call('GET')
    expect(before.data.data).toHaveLength(2) // 索引缺失 → 扫描回退，list 正常时直接可见

    // 清掉扫描结果触发的索引，再验证 rebuild 强制路径
    kv!.store.delete('image_records_index')
    const rebuilt = await call('GET', '?rebuild=1')
    expect(rebuilt.data.code).toBe(0)
    expect(rebuilt.data.msg).toContain('索引已重建')
    expect(rebuilt.data.data.total).toBe(2)
    expect(kv!.store.has('image_records_index')).toBe(true)
  })

  it('全表扫描排除索引键自身（否则索引数组会被当成一条记录混入列表）', async () => {
    // 预置一条真实记录 + 一个已存在的索引（索引键同样命中 image_ 前缀）
    kv!.store.set('image_real1', JSON.stringify(rec('real1', 1)))
    kv!.store.set('image_records_index', JSON.stringify([{ id: 'real1', createdAt: 1 }]))
    // rebuild 强制走扫描路径：若不过滤索引键，扫描结果会混入 1 条坏记录
    const rebuilt = await call('GET', '?rebuild=1')
    expect(rebuilt.data.data.total).toBe(1)
    expect(rebuilt.data.data.records[0].id).toBe('real1')
  })

  it('扫描结果为空时不固化空索引（KV.list 不可用时不清空历史）', async () => {
    // 预置索引 + 本体，然后让 list 故障且删掉索引 → 模拟"索引丢失 + list 不可用"
    kv!.store.set('image_keep1', JSON.stringify(rec('keep1', 2)))
    ;(kv as any)!.list = async () => ({ keys: [], complete: true })
    const rebuilt = await call('GET', '?rebuild=1')
    expect(rebuilt.data.data.total).toBe(0)
    // 关键断言：不允许写空索引（否则后续记录永远无法通过扫描恢复）
    expect(kv!.store.has('image_records_index')).toBe(false)
  })

  it('快路径信任索引：本体暂时读不到时记录仍可见（默认 GET 不逐条读本体）', async () => {
    await call('POST', '', { records: [rec('grace1')] })
    kv!.store.delete('image_grace1') // 模拟读写延迟：本体暂时不可见
    const get = await call('GET')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['grace1'])
  })

  it('?verify=1：本体已丢失且超过宽限期的幽灵条目从索引剔除', async () => {
    await call('POST', '', { records: [rec('gone1', 5)] }) // 5 分钟前创建，远超 60 秒宽限期
    kv!.store.delete('image_gone1')
    const get = await call('GET', '?verify=1')
    expect(get.data.data).toHaveLength(0)
    const index = JSON.parse(kv!.store.get('image_records_index')!)
    expect(index).toHaveLength(0)
  })

  it('?verify=1：宽限期内本体暂时读不到仍保留（防最终一致性误判）', async () => {
    await call('POST', '', { records: [rec('grace2')] })
    kv!.store.delete('image_grace2')
    const get = await call('GET', '?verify=1')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['grace2'])
  })

  it('软删除：索引条目打上 deletedAt 标记，回收站视图免扫描可见', async () => {
    await call('POST', '', { records: [rec('sd1')] })
    const del = await call('DELETE', '?id=sd1')
    expect(del.data.code).toBe(0)
    const index = JSON.parse(kv!.store.get('image_records_index')!)
    expect(index[0].deletedAt).toBeTruthy()
    const trash = await call('GET', '?trash=1')
    expect(trash.data.data.map((r: any) => r.id)).toEqual(['sd1'])
  })

  it('恢复：索引条目清除 deletedAt，重新回到默认列表', async () => {
    await call('POST', '', { records: [rec('rs1')] })
    await call('DELETE', '?id=rs1')
    const put = await call('PUT', '?id=rs1')
    expect(put.data.code).toBe(0)
    const index = JSON.parse(kv!.store.get('image_records_index')!)
    expect(index[0].deletedAt).toBeUndefined()
    const get = await call('GET')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['rs1'])
  })

  it('彻底删除：服务端联动删除 CNB 源文件，失败数如实上报；索引条目同步移除', async () => {
    await call('POST', '', { records: [rec('pg1')] })
    // 测试 env 为空（无 SLUG_IMG/TOKEN_IMG）：有效路径计入 failed，不谎报成功
    const del = await call('DELETE', '?id=pg1&purge=1')
    expect(del.data.code).toBe(0)
    expect(del.data.data.cnbFailed).toBe(1)
    expect(kv!.store.has('image_pg1')).toBe(false)
    const index = JSON.parse(kv!.store.get('image_records_index')!)
    expect(index.find((r: any) => r.id === 'pg1')).toBeUndefined()
  })

  it('索引分片：超过单值上限时自动切分，读取端透明合并', async () => {
    const big = makeBigIndex(1500)
    expect(JSON.stringify(big).length).toBeGreaterThan(INDEX_SAFE_LIMIT_BYTES)
    expect(await writeIndex(big)).toBe(true)
    const marker = JSON.parse(kv!.store.get('image_records_index')!)
    expect(marker.__sharded).toBe(true)
    expect(marker.shards).toBeGreaterThanOrEqual(2)
    expect(kv!.store.has(`${INDEX_SHARD_PREFIX}0`)).toBe(true)
    const merged = await readIndex()
    expect(merged).toHaveLength(1500)
    expect(merged[0].id).toBe('id0')
    expect(merged.at(-1)!.id).toBe('id1499')
  })

  it('索引分片：缩容回单键后清理遗留分片键（防幽灵条目复活）', async () => {
    await writeIndex(makeBigIndex(1500))
    expect(await writeIndex(makeBigIndex(10))).toBe(true)
    const main = JSON.parse(kv!.store.get('image_records_index')!)
    expect(Array.isArray(main)).toBe(true)
    const shardKeys = [...kv!.store.keys()].filter((k) => k.startsWith(INDEX_SHARD_PREFIX))
    expect(shardKeys).toHaveLength(0)
    expect(await readIndex()).toHaveLength(10)
  })

  it('分片索引布局下 GET 快路径正常返回全量列表', async () => {
    await writeIndex(makeBigIndex(1200))
    const get = await call('GET')
    expect(get.data.data).toHaveLength(1200)
  })
})
