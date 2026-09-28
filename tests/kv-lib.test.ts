// KV 记录接口 _lib.js 纯函数测试（buildStats / sortRecords / buildIndex / purge 过滤）
import { describe, it, expect } from 'vitest'
import { buildStats, sortRecords, buildIndex } from '../functions/image-records/_lib.js'

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
