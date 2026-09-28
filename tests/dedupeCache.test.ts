// dedupeCache 单元测试：会话内秒传查重表
import { describe, it, expect, beforeEach } from 'vitest'
import { lookupHash, rememberHash } from '@/utils/dedupeCache'

const entry = (id: string) => ({
  url: `https://x.com/api/img/${id}.webp`,
  recordId: id,
  name: `${id}.webp`,
  size: 100,
  type: 'image/webp',
  createdAt: 1,
})

describe('dedupeCache', () => {
  beforeEach(() => {
    // 每个用例独立 key 空间，避免跨用例污染
  })

  it('remember 后可 lookup 命中', () => {
    rememberHash('h1', entry('a'))
    expect(lookupHash('h1')?.recordId).toBe('a')
  })

  it('未登记的 hash 返回 null', () => {
    expect(lookupHash('missing')).toBeNull()
  })

  it('同 hash 覆盖为最新记录', () => {
    rememberHash('h2', entry('a'))
    rememberHash('h2', entry('b'))
    expect(lookupHash('h2')?.recordId).toBe('b')
  })
})
