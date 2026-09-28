// KV 记录接口 _lib.js 纯函数测试（buildStats / sortRecords / buildIndex / purge 过滤 / 共享限流 / 孤儿路径归一化）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildStats, sortRecords, buildIndex, isRateLimited, cnbImgPathOf, normalizeAssetPath } from '../functions/image-records/_lib.js'

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
