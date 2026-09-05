import crypto from 'node:crypto'

// 访问 token 有效期：默认 24 小时
const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
// "记住我" token 有效期：7 天
const REMEMBER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 获取认证密钥：优先使用 AUTH_SECRET 环境变量，
 * 未设置时从 SITE_PASSWORD 派生，保证已有部署无需新增配置即可使用
 */
function getAuthSecret(): string {
  return process.env.AUTH_SECRET || `imgbed-auth:${process.env.SITE_PASSWORD || ''}`
}

/**
 * 签发访问 token（HMAC-SHA256 签名 + 过期时间，替代旧的固定字符串）
 * @param remember 勾选"记住我"时签发 7 天长效 token
 */
function signAuthToken(remember: boolean = false): string {
  const ttl = remember ? REMEMBER_TOKEN_TTL_MS : AUTH_TOKEN_TTL_MS
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + ttl, nonce: crypto.randomUUID() }),
  ).toString('base64url')
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(payload)
    .digest('base64url')
  return `${payload}.${sig}`
}

/**
 * 校验访问 token 的签名与有效期
 */
function verifyAuthToken(token: string): boolean {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  try {
    const expected = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest()
    const sigBuf = Buffer.from(sig, 'base64url')
    if (sigBuf.length !== expected.length || !crypto.timingSafeEqual(sigBuf, expected)) {
      return false
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.exp === 'number' && data.exp > Date.now()
  } catch {
    return false
  }
}

/**
 * 通过文件头（magic bytes）识别真实图片类型，
 * 防止仅伪造 multipart Content-Type 上传非图片文件
 */
function detectImageMime(buf: Buffer): string | null {
  if (!buf || buf.length < 12) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // WebP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * 常数时间密码比较（先哈希统一长度），防止时序攻击逐位猜解
 */
function securePasswordCompare(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * 上传文件到 CNB 对象存储
 * @param {object} param0 - 上传参数
 * @param {Buffer} param0.fileBuffer - 文件的 Buffer
 * @param {string} param0.fileName - 文件名
 * @param {string} [param0.type='imgs'] - 上传类型，默认为 'imgs'
 * @returns 上传结果包含资源信息和URL
 */
async function uploadToCnb({
  fileBuffer,
  fileName,
  type = 'imgs',
}: {
  fileBuffer: Buffer
  fileName: string
  type?: string
}) {
  const fileSize = fileBuffer.length
  const metaUrl = `https://api.cnb.cool/${process.env.SLUG_IMG}/-/upload/${type}`

  const metaResp = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TOKEN_IMG}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: fileName, size: fileSize }),
  })

  if (!metaResp.ok) {
    throw new Error('Failed to get upload metadata')
  }

  const { assets, upload_url } = await metaResp.json()

  const uploadResp = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  })

  if (!uploadResp.ok) {
    throw new Error('Failed to upload image')
  }

  return { assets, url: assets['path'] }
}

/**
 * 创建代理处理函数
 * @param {string} baseUrl 基础URL
 * @param {object} requestConfig 请求配置
 * @returns 路由处理函数
 */
function createProxyHandler(
  baseUrl: string,
  requestConfig: { headers?: Record<string, string>; timeout?: number },
) {
  return async (req: any, res: any) => {
    try {
      // EdgeOne Maker 环境兼容：尝试多种方式获取路径
      let urlPath = ''

      // 方式1: 从 params.path 获取（标准 Express）
      if (req.params.path) {
        urlPath = Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path
      }

      // 方式2: 从 req.path 或 req.url 提取（EdgeOne 环境）
      if (!urlPath) {
        const fullPath = req.path || req.url || ''
        // 移除 /api/img/ 前缀
        const match = fullPath.match(/\/img\/(.+)/)
        if (match) {
          urlPath = match[1]
        }
      }

      if (!urlPath || urlPath.includes('..') || urlPath.includes('\\') || urlPath.startsWith('/')) {
        console.error('❌ [Proxy] Invalid path:', { params: req.params, path: req.path, url: req.url })
        return res.status(400).json({ error: 'Invalid image path' })
      }

      // 额外验证：只允许与上传白名单一致的图片扩展名
      // （SVG 可内嵌脚本存在 XSS 风险，bmp/ico 上传侧本就不允许，均不放行）
      const allowedExtensions = /\.(jpg|jpeg|png|gif|webp)$/i
      if (!allowedExtensions.test(urlPath)) {
        console.error('❌ [Proxy] Forbidden file type:', urlPath)
        return res.status(403).json({ error: 'Forbidden file type' })
      }

      const targetUrl = new URL(urlPath, baseUrl).toString()
      console.log(`🔄 [Proxy] ${req.path || req.url} -> ${targetUrl}`)

      const fetchOptions = {
        method: 'GET',
        headers: requestConfig?.headers || {},
        signal: requestConfig?.timeout ? AbortSignal.timeout(requestConfig.timeout) : undefined,
      }

      const response = await fetch(targetUrl, fetchOptions)

      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/png'
        // 上游返回非图片内容时拒绝，防止将 HTML/脚本作为图片代理输出
        if (!contentType.startsWith('image/')) {
          console.error(`❌ [Proxy] Unexpected content-type: ${contentType}`)
          return res.status(502).json({ error: 'Upstream returned non-image content' })
        }
        const arrayBuffer = await response.arrayBuffer()

        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.send(Buffer.from(arrayBuffer))
      } else {
        console.error(`❌ [Proxy] Upstream error: ${response.status} ${response.statusText}`)
        res.status(response.status).json({
          error: `Upstream error: ${response.statusText}`,
        })
      }
    } catch (e: unknown) {
      const error = e as Error
      console.error(`❌ [Proxy Error] ${error.message}`)
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return res.status(504).json({ error: 'Upstream request timed out' })
      }
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return res.status(502).json({ error: 'Failed to fetch from upstream' })
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }
}

/**
 * 从 CNB URL 中提取图片路径
 */
function extractImagePath(url: string): string {
  if (url.includes('-/imgs/')) {
    return url.split('-/imgs/')[1]
  } else if (url.includes('-/files/')) {
    return url.split('-/files/')[1]
  }
  return url
}

export { uploadToCnb, createProxyHandler, signAuthToken, verifyAuthToken, detectImageMime, securePasswordCompare, extractImagePath }