// S3 SigV4 签名 + 多存储路由标记测试
// 签名部分以 AWS 官方文档示例向量为基准（GET Object，virtual-host），防止规范化/密钥链回归
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { signS3Request, sigUriEncode, EMPTY_SHA256 } from '../node-functions/api/_s3'
import { parseStoragePath, extractStoragePath } from '../node-functions/api/_storage'
import { storageMarkerOf, splitSourcePaths } from '../functions/image-records/_lib.js'

describe('sigUriEncode（AWS 规则：仅 A-Za-z0-9-._~ 不编码）', () => {
  it('编码保留字符与多字节字符，保留斜杠可选', () => {
    expect(sigUriEncode('a b+c~d.e_f-g')).toBe('a%20b%2Bc~d.e_f-g')
    expect(sigUriEncode('中文/路径.jpg', false)).toBe('%E4%B8%AD%E6%96%87/%E8%B7%AF%E5%BE%84.jpg')
    expect(sigUriEncode('中文/路径.jpg', true)).toBe('%E4%B8%AD%E6%96%87%2F%E8%B7%AF%E5%BE%84.jpg')
    // encodeURIComponent 会放过 ! ' ( ) *，AWS 规范要求编码
    expect(sigUriEncode("img!'()*")).toBe('img%21%27%28%29%2A')
  })
})

describe('signS3Request：AWS 官方文档向量（GET Object）', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  // GET https://examplebucket.s3.amazonaws.com/test.txt，Range: bytes=0-9，空 body
  const cfg = {
    id: 'example',
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'examplebucket',
    region: 'us-east-1',
    pathStyle: false,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  }

  it('签名与官方示例完全一致（f0e8bdb8…）', () => {
    const signed = signS3Request(
      cfg,
      'GET',
      'test.txt',
      {},
      { Range: 'bytes=0-9' },
      EMPTY_SHA256,
      new Date('2013-05-24T00:00:00Z'),
    )
    const sig = signed.headers.Authorization.match(/Signature=([0-9a-f]{64})/)![1]
    expect(sig).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(signed.headers.Authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request')
    expect(signed.headers.Authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date')
    expect(signed.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt')
  })

  it('path-style 下路径携带桶名，查询参数按规范排序编码', () => {
    const signed = signS3Request(
      { ...cfg, pathStyle: true },
      'GET',
      '',
      { 'list-type': '2', 'max-keys': '1000', 'continuation-token': 'a+b/c' },
      {},
      EMPTY_SHA256,
      new Date('2013-05-24T00:00:00Z'),
    )
    expect(signed.url).toBe(
      'https://s3.amazonaws.com/examplebucket/?continuation-token=a%2Bb%2Fc&list-type=2&max-keys=1000',
    )
    expect(signed.headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
  })
})

describe('parseStoragePath / extractStoragePath（node 侧路由标记）', () => {
  it('s3-{id}/{key} 解析出桶 id 与 key', () => {
    expect(parseStoragePath('s3-oss-main/img/2026/a.webp')).toEqual({
      storage: 's3',
      id: 'oss-main',
      key: 'img/2026/a.webp',
    })
  })

  it('无标记路径归 CNB', () => {
    expect(parseStoragePath('timestamp.webp')).toEqual({ storage: 'cnb', path: 'timestamp.webp' })
  })

  it('关键歧义防护：CNB 原名文件以 s3- 开头但无二级路径，不误判为标记', () => {
    expect(parseStoragePath('s3-photo.jpg')).toEqual({ storage: 'cnb', path: 's3-photo.jpg' })
    expect(parseStoragePath('s3-oss.jpg')).toEqual({ storage: 'cnb', path: 's3-oss.jpg' })
  })

  it('非法 id 形态按 CNB 处理（走原有 404 逻辑）', () => {
    expect(parseStoragePath('s3-UPPER/x.jpg')).toEqual({ storage: 'cnb', path: 's3-UPPER/x.jpg' })
    expect(parseStoragePath('s3-/x.jpg')).toEqual({ storage: 'cnb', path: 's3-/x.jpg' })
  })

  it('extractStoragePath 兼容代理链接、查询串与 CNB 原生链接', () => {
    expect(extractStoragePath('https://img.example.com/api/img/s3-r2/a.png?x=1')).toEqual({
      storage: 's3',
      id: 'r2',
      key: 'a.png',
    })
    expect(extractStoragePath('https://img.example.com/api/img/timestamp.webp')).toEqual({
      storage: 'cnb',
      path: 'timestamp.webp',
    })
    expect(extractStoragePath('https://cnb.cool/repo/-/imgs/legacy.png')).toEqual({
      storage: 'cnb',
      path: 'legacy.png',
    })
  })
})

describe('storageMarkerOf / splitSourcePaths（边缘侧分组，与 node 侧同规则）', () => {
  it('混合记录按存储分组，S3 路径保留完整标记，CNB 路径剥前缀', () => {
    const records = [
      { url: 'https://x.example.com/api/img/s3-oss1/a.webp', thumbnailUrl: 'https://x.example.com/api/img/s3-oss1/a_thumb.webp' },
      { url: 'https://x.example.com/api/img/b.png' },
      { url: 'https://cnb.cool/repo/-/imgs/c.jpg' },
      { url: 'https://x.example.com/api/img/s3-photo.jpg' }, // CNB 原名歧义防护
    ]
    const { cnbPaths, s3Paths } = splitSourcePaths(records)
    expect(cnbPaths).toEqual(['b.png', 'c.jpg', 's3-photo.jpg'])
    expect(s3Paths).toEqual(['s3-oss1/a.webp', 's3-oss1/a_thumb.webp'])
  })

  it('S3 标记归属正确的桶 id', () => {
    expect(storageMarkerOf('https://x.example.com/api/img/s3-oss1/a.webp')).toEqual({
      id: 'oss1',
      path: 's3-oss1/a.webp',
    })
    expect(storageMarkerOf('https://x.example.com/api/img/s3-photo.jpg')).toEqual({
      id: 'cnb',
      path: 's3-photo.jpg',
    })
    expect(storageMarkerOf('')).toBeNull()
  })

  it('同键去重（主图与缩略图重复引用只删一次）', () => {
    const records = [
      { url: 'https://x.example.com/api/img/s3-oss1/a.webp' },
      { url: 'https://x.example.com/api/img/s3-oss1/a.webp' },
    ]
    const { s3Paths } = splitSourcePaths(records)
    expect(s3Paths).toEqual(['s3-oss1/a.webp'])
  })
})

describe('SigV4 密钥链（与 AWS 官方推导过程一致性的对照实现）', () => {
  it('签名密钥链逐步 HMAC 后结果可复现官方向量', () => {
    // 与 _s3.ts 相同的链式推导，独立复算官方示例的签名作为交叉验证
    const kDate = hmac(`AWS4wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, '20130524')
    const kRegion = hmac(kDate, 'us-east-1')
    const kService = hmac(kRegion, 's3')
    const kSigning = hmac(kService, 'aws4_request')
    const canonical = [
      'GET',
      '/test.txt',
      '',
      'host:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20130524T000000Z\n',
      'host;range;x-amz-content-sha256;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      '20130524T000000Z',
      '20130524/us-east-1/s3/aws4_request',
      crypto.createHash('sha256').update(canonical).digest('hex'),
    ].join('\n')
    const sig = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
    expect(sig).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}
