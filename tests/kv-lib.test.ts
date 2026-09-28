// KV 记录接口 _lib.js 纯函数测试（buildStats / sortRecords / buildIndex / purge 过滤 / 共享限流 / 孤儿路径归一化）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildStats, sortRecords, buildIndex, isRateLimited, cnbImgPathOf, normalizeAssetPath } from '../functions/image-records/_lib.js'
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

  it('扫描结果为空时不固化空索引（KV.list 不可用时不清空历史）', async () => {
    // 预置索引 + 本体，然后让 list 故障且删掉索引 → 模拟"索引丢失 + list 不可用"
    kv!.store.set('image_keep1', JSON.stringify(rec('keep1', 2)))
    ;(kv as any)!.list = async () => ({ keys: [], complete: true })
    const rebuilt = await call('GET', '?rebuild=1')
    expect(rebuilt.data.data.total).toBe(0)
    // 关键断言：不允许写空索引（否则后续记录永远无法通过扫描恢复）
    expect(kv!.store.has('image_records_index')).toBe(false)
  })

  it('60 秒宽限期：刚写入的记录本体暂时读不到时仍保留在列表', async () => {
    await call('POST', '', { records: [rec('grace1')] })
    kv!.store.delete('image_grace1') // 模拟读写延迟：本体暂时不可见
    const get = await call('GET')
    expect(get.data.data.map((r: any) => r.id)).toEqual(['grace1'])
  })
})
