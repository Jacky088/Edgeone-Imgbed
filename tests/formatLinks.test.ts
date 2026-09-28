// formatLinks 纯函数测试：四种复制格式的转义规则
import { describe, it, expect } from 'vitest'
import { buildFormats } from '@/utils/formatLinks'

describe('buildFormats', () => {
  const info = { url: 'https://img.example.com/api/img/hello world(1).webp', name: 'hello world(1).webp' }

  it('url 格式原样返回 baseUrl', () => {
    const fmt = buildFormats(info).find((f) => f.key === 'url')
    expect(fmt?.value).toBe('https://img.example.com/api/img/hello world(1).webp')
  })

  it('html 格式转义属性中的 & " < >', () => {
    const fmt = buildFormats({ url: 'https://x.com/a?b=1&c=2"onerror=x', name: 'a<b>.webp' }).find((f) => f.key === 'html')
    expect(fmt?.value).toBe('<img src="https://x.com/a?b=1&amp;c=2&quot;onerror=x" alt="a&lt;b&gt;" />')
  })

  it('markdown 格式编码右括号防止打断链接', () => {
    const fmt = buildFormats(info).find((f) => f.key === 'markdown')
    // escapeLink 把 ) 编码为 %29，防止文件名中的括号打断 Markdown 链接语法
    expect(fmt?.value).toBe('![hello world(1)](https://img.example.com/api/img/hello world(1%29.webp)')
  })

  it('markdown alt 取文件名去扩展名', () => {
    const fmt = buildFormats({ url: 'https://x.com/a.webp', name: '我的图片.webp' }).find((f) => f.key === 'markdown')
    expect(fmt?.value).toContain('![我的图片]')
  })

  it('bbcode 格式包裹 [img] 标签', () => {
    const fmt = buildFormats({ url: 'https://x.com/a.webp' }).find((f) => f.key === 'bbcode')
    expect(fmt?.value).toBe('[img]https://x.com/a.webp[/img]')
  })

  it('可传入 baseUrl 用缩略图替代原图链接', () => {
    const fmt = buildFormats(
      { url: 'https://x.com/full.webp', thumbnailUrl: 'https://x.com/thumb.webp' },
      'https://x.com/thumb.webp',
    ).find((f) => f.key === 'url')
    expect(fmt?.value).toBe('https://x.com/thumb.webp')
  })

  it('缺失 name 时 alt 回退为 img', () => {
    const fmt = buildFormats({ url: 'https://x.com/a.webp' }).find((f) => f.key === 'markdown')
    expect(fmt?.value).toContain('![img]')
  })
})
