// node-functions _utils.ts 纯函数测试：magic bytes / 文件名清洗 / token 签发校验
import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import {
  detectImageMime,
  sanitizeFilename,
  fixMulterFilename,
  signAuthToken,
  verifyAuthToken,
  extractCnbImgPath,
  isValidImgPath,
} from '../node-functions/api/_utils'
import { verifyAuthToken as verifyAuthTokenEdge } from '../functions/image-records/_lib.js'
import { createSharedWindowLimiter, sanitizeLimitKey } from '../node-functions/api/_middleware'

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
  it('剥离路径遍历（/ 替换为下划线，连续点折叠为单点）', () => {
    // 连续点折叠：'foo..bar.jpg' 若原样保留，代理侧 '..' 校验会 400，直链永远打不开
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('._._etc_passwd.png')
    expect(sanitizeFilename('../../etc/passwd.png')).not.toContain('/')
    expect(sanitizeFilename('foo..bar.jpg')).toBe('foo.bar.jpg')
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

// 契约测试：Node 侧（node:crypto 签发）与 Edge 侧（Web Crypto 校验）是两套独立实现，
// 靠"同一密钥派生规则 + 同一 payload/sig 格式"互认。任何一侧改动导致互认破裂时在此暴露，
// 避免部署后 /image-records 全量 401
describe('跨端 token 互认契约（Node 签发 ↔ Edge 校验）', () => {
  const edgeEnv = { AUTH_SECRET: 'test-secret' }

  it('Node 签发的 token 可被 Edge 侧校验通过', async () => {
    const token = signAuthToken(false)
    expect(await verifyAuthTokenEdge(token, edgeEnv)).toBe(true)
  })
  it('Node 签发的"记住我"长效 token 同样通过 Edge 校验', async () => {
    expect(await verifyAuthTokenEdge(signAuthToken(true), edgeEnv)).toBe(true)
  })
  it('篡改 payload 被 Edge 侧拒绝', async () => {
    const token = signAuthToken(false)
    const sig = token.split('.')[1]
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 99999999 })).toString('base64url')
    expect(await verifyAuthTokenEdge(`${forged}.${sig}`, edgeEnv)).toBe(false)
  })
  it('过期 token 被 Edge 侧拒绝', async () => {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000, nonce: 'x' })).toString('base64url')
    const sig = crypto.createHmac('sha256', 'test-secret').update(payload).digest('base64url')
    expect(await verifyAuthTokenEdge(`${payload}.${sig}`, edgeEnv)).toBe(false)
  })
  it('Edge 侧风格（Web Crypto）签名的 token 可被 Node 侧校验通过', async () => {
    // 反向互认：Edge 运行时只有 Web Crypto；确保 Node 校验接受 Web Crypto 产生的同规格签名
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000, nonce: 'edge-nonce' })).toString('base64url')
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('test-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
    const sig = Buffer.from(mac).toString('base64url')
    expect(verifyAuthToken(`${payload}.${sig}`)).toBe(true)
  })
})

// 共享限流器（createSharedWindowLimiter）：本地内存快路径 + 注入存储的跨实例权威计数
describe('createSharedWindowLimiter（Node 共享限流）', () => {
  function makeFakeStore() {
    const map = new Map<string, string>()
    return {
      map,
      store: {
        get: async (key: string) => map.get(key) ?? null,
        set: async (key: string, value: unknown) => map.set(key, String(value)),
        delete: async (key: string) => map.delete(key),
      },
    }
  }

  it('跨实例共享计数：两个实例合计不超过上限', async () => {
    const { map, store } = makeFakeStore()
    // 两个 limiter 实例模拟 serverless 的两个函数实例，共享同一存储
    const instanceA = createSharedWindowLimiter(store)
    const instanceB = createSharedWindowLimiter(store)
    expect(await instanceA('1.2.3.4//upload/img', 3)).toBe(false)
    expect(await instanceA('1.2.3.4//upload/img', 3)).toBe(false)
    expect(await instanceB('1.2.3.4//upload/img', 3)).toBe(false) // 全局第 3 次，放行
    expect(await instanceB('1.2.3.4//upload/img', 3)).toBe(true) // 全局第 4 次，拒绝
    expect([...map.values()]).toContain('3')
  })

  it('无存储（null）时降级为纯内存限流', async () => {
    const limiter = createSharedWindowLimiter(null)
    const results = []
    for (let i = 0; i < 4; i++) results.push(await limiter('ip-a', 3))
    expect(results).toEqual([false, false, false, true])
  })

  it('存储读写异常时降级为内存限流（不抛出）', async () => {
    const boom = {
      get: async () => {
        throw new Error('storage down')
      },
      set: async () => {
        throw new Error('storage down')
      },
      delete: async () => {},
    }
    const limiter = createSharedWindowLimiter(boom)
    const results = []
    for (let i = 0; i < 3; i++) results.push(await limiter('ip-b', 2))
    expect(results).toEqual([false, false, true])
  })

  it('sanitizeLimitKey 输出仅含安全字符且互不碰撞', () => {
    for (const raw of ['1.2.3.4', '::ffff:1.2.3.4', '1.2', '1:2', '/upload/img', 'a b', 'a_b']) {
      expect(sanitizeLimitKey(raw)).toMatch(/^[a-zA-Z0-9_]+$/)
    }
    expect(sanitizeLimitKey('1.2')).not.toBe(sanitizeLimitKey('1:2'))
    expect(sanitizeLimitKey('a b')).not.toBe(sanitizeLimitKey('a_b'))
  })
})

describe('extractCnbImgPath', () => {
  it('从 /api/img/ 代理链接提取 imgPath', () => {
    expect(extractCnbImgPath('https://img.example.com/api/img/2024/abc.png')).toBe('2024/abc.png')
  })
  it('从原生 -/imgs/ 链接提取 imgPath', () => {
    expect(extractCnbImgPath('https://cnb.cool/user/repo/-/imgs/abc/1234.png')).toBe('abc/1234.png')
  })
  it('截断查询串与锚点', () => {
    expect(extractCnbImgPath('https://img.example.com/api/img/a/b.webp?x=1#f')).toBe('a/b.webp')
  })
  it('中文文件名可提取', () => {
    expect(extractCnbImgPath('https://img.example.com/api/img/imgs/截图 测试.png')).toBe('imgs/截图 测试.png')
  })
  it('无标记时返回 null', () => {
    expect(extractCnbImgPath('https://other.example.com/foo.png')).toBeNull()
  })
})

describe('isValidImgPath', () => {
  it('放行正常路径与中文', () => {
    expect(isValidImgPath('2024/abc.png')).toBe(true)
    expect(isValidImgPath('imgs/截图.png')).toBe(true)
    expect(isValidImgPath('a/b-c_d.e/f.webp')).toBe(true)
  })
  it('拒绝路径遍历与反斜杠', () => {
    expect(isValidImgPath('a/../b.png')).toBe(false)
    expect(isValidImgPath('..\\x.png')).toBe(false)
    expect(isValidImgPath('a\\b.png')).toBe(false)
  })
  it('拒绝空值、绝对路径与非法字符', () => {
    expect(isValidImgPath('')).toBe(false)
    expect(isValidImgPath('/abs.png')).toBe(false)
    expect(isValidImgPath('a b.png')).toBe(false)
    expect(isValidImgPath('a?b.png')).toBe(false)
  })
  it('拒绝超长路径', () => {
    expect(isValidImgPath('a/'.repeat(300) + 'x.png')).toBe(false)
  })
})
