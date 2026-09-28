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
// CNB API 超时：挂起时及时失败，避免占住函数实例
const CNB_TIMEOUT_MS = 30_000

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
    signal: AbortSignal.timeout(CNB_TIMEOUT_MS),
  })

  if (!metaResp.ok) {
    throw new Error('Failed to get upload metadata')
  }

  const meta = (await metaResp.json()) as { assets?: Record<string, string>; upload_url?: string }
  const { assets, upload_url } = meta
  if (!assets?.path || !upload_url) {
    throw new Error('CNB upload metadata response is missing assets/upload_url')
  }

  const uploadResp = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
    signal: AbortSignal.timeout(CNB_TIMEOUT_MS),
  })

  if (!uploadResp.ok) {
    throw new Error('Failed to upload image')
  }

  return { assets, url: assets['path'] }
}

// ===== CNB 容量探测（Charge API + 资产清单）=====
// 存储卡数据全部来自 CNB 官方接口，不再使用浏览器端手动配额：
//   - 图片总量：GET /{slug}/-/list-assets 分页汇总 slug_img 资产的 size_in_byte（需 repo-manage:r）
//   - 用量/额度：GET /{slug}/-/charge/volume、/-/charge/quota（需 group-resource:r）
// 进程内缓存 10 分钟；refresh=1 绕过缓存（孤儿清理后立即刷新）。
// 图片清单不可读（缺 repo-manage:r）时 images 为 null，用量/额度不受影响。
export interface CnbStorageUsage {
  /** 本仓库图片总量（slug_img 资产 size_in_byte 之和）；清单不可读时为 null */
  images: { count: number; usedBytes: number; truncated?: boolean } | null
  /** 图片清单读取失败原因（images 为 null 时有值） */
  imagesReason?: string
  /** 组织对象存储用量/额度（含 git lfs、制品、附件） */
  object: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
  /** 组织 git 存储用量/额度（不含 lfs） */
  git: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
}

const STORAGE_CACHE_TTL_MS = 10 * 60 * 1000
const CNB_ASSETS_PAGE_SIZE = 100
const CNB_ASSETS_MAX_PAGES = 30 // 单次汇总上限 3000 个资产，超出标记 truncated
let storageCache: { at: number; data: CnbStorageUsage } | null = null

/** 分页汇总仓库图片总量；失败返回 { ok:false }（独立降级，不阻塞用量/额度展示） */
async function sumCnbImageAssets(
  slug: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ ok: boolean; reason?: string; count?: number; usedBytes?: number; truncated?: boolean }> {
  let count = 0
  let usedBytes = 0
  try {
    for (let page = 1; page <= CNB_ASSETS_MAX_PAGES; page++) {
      const resp = await fetch(
        `https://api.cnb.cool/${slug}/-/list-assets?page=${page}&page_size=${CNB_ASSETS_PAGE_SIZE}`,
        { headers, signal },
      )
      if (resp.status === 403) return { ok: false, reason: 'images-forbidden' }
      if (!resp.ok) return { ok: false, reason: 'upstream' }
      const list = (await resp.json()) as Array<{ record_type?: string; size_in_byte?: number }>
      if (!Array.isArray(list)) return { ok: false, reason: 'upstream' }
      for (const item of list) {
        if (item.record_type === 'slug_img') {
          count++
          usedBytes += Number(item.size_in_byte) || 0
        }
      }
      if (list.length < CNB_ASSETS_PAGE_SIZE) {
        return { ok: true, count, usedBytes, truncated: false }
      }
    }
  } catch {
    return { ok: false, reason: 'network' }
  }
  return { ok: true, count, usedBytes, truncated: true }
}

async function fetchCnbStorageUsage(refresh = false): Promise<{ available: boolean; reason?: string; data?: CnbStorageUsage }> {
  // 数据变化缓慢，进程内缓存 10 分钟；refresh=1 绕过（孤儿清理后立即刷新）
  if (!refresh && storageCache && Date.now() - storageCache.at < STORAGE_CACHE_TTL_MS) {
    return { available: true, data: storageCache.data }
  }
  const slug = process.env.SLUG_IMG
  const token = process.env.TOKEN_IMG
  if (!slug || !token) return { available: false, reason: 'missing-env' }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const signal = AbortSignal.timeout(CNB_TIMEOUT_MS)
  try {
    const [volumeResp, quotaResp] = await Promise.all([
      fetch(`https://api.cnb.cool/${slug}/-/charge/volume`, { headers, signal }),
      fetch(`https://api.cnb.cool/${slug}/-/charge/quota`, { headers, signal }),
    ])

    if (volumeResp.status === 403 || quotaResp.status === 403) {
      return { available: false, reason: 'forbidden' }
    }
    if (!volumeResp.ok || !quotaResp.ok) {
      return { available: false, reason: 'upstream' }
    }

    const volume = (await volumeResp.json()) as Record<string, unknown>
    const quota = (await quotaResp.json()) as {
      git_in_byte?: { free?: number; total?: number }
      object_in_byte?: { free?: number; total?: number }
    }

    // 图片总量：独立降级（令牌缺 repo-manage:r 时不影响额度展示）
    const assets = await sumCnbImageAssets(slug, headers, signal)

    const data: CnbStorageUsage = {
      images: assets.ok
        ? { count: assets.count || 0, usedBytes: assets.usedBytes || 0, truncated: assets.truncated }
        : null,
      imagesReason: assets.ok ? undefined : assets.reason,
      object: {
        usedBytes: Number(volume.object_in_byte) || 0,
        quotaBytes: quota.object_in_byte?.total ?? null,
        freeBytes: quota.object_in_byte?.free ?? null,
      },
      git: {
        usedBytes: Number(volume.git_in_byte) || 0,
        quotaBytes: quota.git_in_byte?.total ?? null,
        freeBytes: quota.git_in_byte?.free ?? null,
      },
    }
    storageCache = { at: Date.now(), data }
    return { available: true, data }
  } catch {
    return { available: false, reason: 'network' }
  }
}

/**
 * 图片代理处理函数（模块级单例：无请求级闭包，每次调用复用同一函数）
 */
const ALLOWED_PROXY_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)$/i

async function proxyImageRequest(
  baseUrl: string,
  requestConfig: { headers?: Record<string, string>; timeout?: number },
  req: any,
  res: any,
) {
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
      if (!ALLOWED_PROXY_EXTENSIONS.test(urlPath)) {
        console.error('❌ [Proxy] Forbidden file type:', urlPath)
        return res.status(403).json({ error: 'Forbidden file type' })
      }

      const target = new URL(urlPath, baseUrl)
      // SSRF 防护：路径若是绝对 URL 会覆盖 base，导致本接口沦为任意主机的开放代理。
      // 目标必须与 BASE_URL 同源，否则拒绝
      if (target.origin !== new URL(baseUrl).origin) {
        console.error('❌ [Proxy] Forbidden image host:', target.origin)
        return res.status(403).json({ error: 'Forbidden image host' })
      }
      const targetUrl = target.toString()
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
          // 上游 body 必须消费掉，否则底层连接无法复用（keep-alive 泄漏）
          await response.arrayBuffer().catch(() => {})
          console.error(`❌ [Proxy] Unexpected content-type: ${contentType}`)
          return res.status(502).json({ error: 'Upstream returned non-image content' })
        }
        const contentLength = response.headers.get('content-length')
        // 代理上限 20MB：超限直接 413，避免 arrayBuffer 全量进内存拖垮实例
        if (contentLength && Number(contentLength) > 20 * 1024 * 1024) {
          await response.arrayBuffer().catch(() => {})
          return res.status(413).json({ error: 'Image too large to proxy' })
        }

        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        // 流式转发：边下边吐，不在内存里攒完整文件（内存占用从 O(文件) 降到 O(分片)）
        if (response.body) {
          const reader = response.body.getReader()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (!res.write(value)) {
                await new Promise<void>((resolve) => res.once('drain', resolve))
              }
            }
            res.end()
          } catch {
            reader.cancel().catch(() => {})
            if (!res.headersSent) {
              return res.status(502).json({ error: 'Failed to stream from upstream' })
            }
            res.end()
          } finally {
            reader.releaseLock()
          }
        } else {
          // 极少数环境无 body 流，回退到旧的全量转发
          const arrayBuffer = await response.arrayBuffer()
          res.send(Buffer.from(arrayBuffer))
        }
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

/** 服务端单文件大小上限（MB），可用环境变量 MAX_UPLOAD_MB 覆盖。
 * 前端压缩后直传产物远小于此值；该上限主要约束 GIF / "保持原图" 的大文件直传 */
const MAX_UPLOAD_MB = (() => {
  const n = Number(process.env.MAX_UPLOAD_MB)
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n)) : 25
})()

/** 上传限流（次/分钟/IP），可用环境变量 UPLOAD_RATE_LIMIT 覆盖 */
const UPLOAD_RATE_LIMIT = (() => {
  const n = Number(process.env.UPLOAD_RATE_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.min(600, Math.round(n)) : 120
})()

/**
 * 修复 multer/busbus 将 UTF-8 文件名按 latin1 解码导致的中文乱码
 */
function fixMulterFilename(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    // 解码失败（出现替换符）则保留原名
    if (decoded && !decoded.includes('\uFFFD')) return decoded
  } catch {
    // ignore
  }
  return name
}

/**
 * 文件名安全过滤：防止路径遍历；保留 Unicode 字母数字（含中文），其余替换为下划线
 */
function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^\p{L}\p{N}._-]/gu, '_')
  return cleaned.length > 100 ? cleaned.slice(0, 100) : cleaned
}

/**
 * 拼接对外图片直链：BASE_IMG_URL 去尾斜杠 + /api/img/ + CNB 路径
 */
function buildPublicUrl(cnbPath: string): string {
  let baseUrl = process.env.BASE_IMG_URL || ''
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
  return `${baseUrl}/api/img/${extractImagePath(cnbPath)}`
}

/** 上传侧允许的 MIME 类型（与前端 allowedTypes 一致） */
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// ===== CNB 源文件删除（与彻底删除联动）=====
// 官方接口 DELETE /{repo}/-/imgs/{imgPath}（删除 UploadImgs 上传的图片），
// 需访问令牌具备 repo-manage:rw 权限。删除是尽力而为：失败只影响源文件（成为孤儿），
// 不影响记录删除流程。404 视为成功（文件本就不存在）。

/** imgPath 白名单：Unicode 字母数字 + ._-/；禁止路径遍历与反斜杠 */
function isValidImgPath(p: string): boolean {
  if (!p || p.length > 512) return false
  if (p.startsWith('/') || p.includes('\\') || p.includes('..')) return false
  return /^[\p{L}\p{N}._\-/]+$/u.test(p)
}

/** 从记录 URL 提取 CNB imgPath：兼容 /api/img/ 代理链接与原生 -/imgs/、-/files/ 链接 */
function extractCnbImgPath(recordUrl: string): string | null {
  const markers = ['/api/img/', '-/imgs/', '-/files/']
  for (const marker of markers) {
    const idx = recordUrl.indexOf(marker)
    if (idx >= 0) {
      const p = recordUrl.slice(idx + marker.length).split(/[?#]/)[0]
      if (p) return p
    }
  }
  return null
}

/** 批量删除 CNB 源文件：urls（自动提取 imgPath）与 paths（直传 imgPath）合并后去重并发删除 */
async function deleteFromCnb(urls: string[], paths: string[] = []): Promise<{ ok: string[]; failed: string[]; skipped: number }> {
  const ok: string[] = []
  const failed: string[] = []
  let skipped = 0
  const slug = process.env.SLUG_IMG
  const token = process.env.TOKEN_IMG
  if (!slug || !token) return { ok, failed, skipped: urls.length + paths.length }

  const seen = new Set<string>()
  const targets: string[] = []
  const addTarget = (imgPath: string | null) => {
    if (!imgPath || !isValidImgPath(imgPath) || seen.has(imgPath)) {
      skipped++
      return
    }
    seen.add(imgPath)
    targets.push(imgPath)
  }
  for (const url of urls) addTarget(extractCnbImgPath(url || ''))
  for (const path of paths) addTarget(typeof path === 'string' ? path : null)

  await Promise.all(
    targets.map(async (imgPath) => {
      const encoded = imgPath.split('/').map(encodeURIComponent).join('/')
      try {
        const resp = await fetch(`https://api.cnb.cool/${slug}/-/imgs/${encoded}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(CNB_TIMEOUT_MS),
        })
        if (resp.ok || resp.status === 404) ok.push(imgPath)
        else failed.push(imgPath)
      } catch {
        failed.push(imgPath)
      }
    }),
  )
  return { ok, failed, skipped }
}

export { proxyImageRequest as createProxyHandler, uploadToCnb, signAuthToken, verifyAuthToken, detectImageMime, securePasswordCompare, extractImagePath, fixMulterFilename, sanitizeFilename, buildPublicUrl, fetchCnbStorageUsage, deleteFromCnb, isValidImgPath, extractCnbImgPath, MAX_UPLOAD_MB, UPLOAD_RATE_LIMIT, ALLOWED_MIMES }