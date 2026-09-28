// node-functions _utils.ts 纯函数测试：magic bytes / 文件名清洗 / token 签发校验
import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import {
  detectImageMime,
  sanitizeFilename,
  fixMulterFilename,
  signAuthToken,
  verifyAuthToken,
} from '../node-functions/api/_utils'

// _utils.ts 顶层 import crypto from 'node:crypto'，Node 环境直接可跑
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret'
})

describe('detectImageMime', () => {
  it('识别 JPEG 魔数', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg')
  })
  it('识别 PNG 魔数', () => {
    expect(
      detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    ).toBe('image/png')
  })
  it('识别 GIF 魔数', () => {
    expect(detectImageMime(Buffer.from('GIF89a' + '000000', 'binary'))).toBe('image/gif')
  })
  it('识别 WebP 魔数', () => {
    expect(detectImageMime(Buffer.from('RIFF0000WEBPVP8 ', 'binary'))).toBe('image/webp')
  })
  it('伪造 Content-Type 的文本内容返回 null', () => {
    expect(detectImageMime(Buffer.from('<html><body>evil</body></html>'))).toBeNull()
  })
  it('过短 buffer 返回 null', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe('sanitizeFilename', () => {
  it('保留中文名与合法字符', () => {
    expect(sanitizeFilename('我的 图片-01.webp')).toBe('我的_图片-01.webp')
  })
  it('剥离路径遍历（. 和 / 均替换为下划线）', () => {
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('.._.._etc_passwd.png')
    // 替换后不再含路径分隔符，无法构造 ../ 遍历（CNB 侧还会对 key 再做规范化）
    expect(sanitizeFilename('../../etc/passwd.png')).not.toContain('/')
  })
  it('超长文件名截断到 100', () => {
    expect(sanitizeFilename('a'.repeat(300) + '.png').length).toBeLessThanOrEqual(100)
  })
})

describe('fixMulterFilename', () => {
  it('latin1 乱码还原为 UTF-8 中文', () => {
    // multer 将 UTF-8 的 "测试" 按 latin1 读入后的字节形态
    const garbled = Buffer.from('测试.png', 'utf8').toString('latin1')
    expect(fixMulterFilename(garbled)).toBe('测试.png')
  })
  it('正常 ASCII 名保持不变', () => {
    expect(fixMulterFilename('photo.png')).toBe('photo.png')
  })
})

describe('signAuthToken / verifyAuthToken', () => {
  it('签发的 token 立即校验通过', () => {
    const token = signAuthToken(false)
    expect(verifyAuthToken(token)).toBe(true)
  })
  it('篡改 payload 校验失败', () => {
    const token = signAuthToken(false)
    const sig = token.split('.')[1]
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 99999999 })).toString('base64url')
    expect(verifyAuthToken(`${forged}.${sig}`)).toBe(false)
  })
  it('过期 token 校验失败', () => {
    // 签一个已过期的 token：直接构造 payload 用已知 secret 签名
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000, nonce: 'x' })).toString('base64url')
    const sig = crypto.createHmac('sha256', 'test-secret').update(payload).digest('base64url')
    expect(verifyAuthToken(`${payload}.${sig}`)).toBe(false)
  })
  it('错误密钥签发的 token 校验失败', () => {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000, nonce: 'x' })).toString('base64url')
    const sig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('base64url')
    expect(verifyAuthToken(`${payload}.${sig}`)).toBe(false)
  })
})
