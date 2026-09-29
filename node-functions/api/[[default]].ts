import crypto from 'node:crypto'
import express from 'express'
import multer from 'multer'
import { reply } from './_reply'
import {
  uploadToCnb,
  createProxyHandler,
  detectImageMime,
  securePasswordCompare,
  signAuthToken,
  fixMulterFilename,
  sanitizeFilename,
  buildPublicUrl,
  fetchCnbStorageUsage,
  MAX_UPLOAD_MB,
  UPLOAD_RATE_LIMIT,
  ALLOWED_MIMES,
} from './_utils'
import { s3PutObject, s3ProbeBucket } from './_s3'
import {
  parseStoragePath,
  getStorageConfig,
  getStorageStats,
  findBucket,
  getActiveBackend,
  toS3Config,
  proxyS3Request,
  deleteAcrossStorages,
  checkQuotaForUpload,
  confirmPendingBytes,
  releasePendingBytes,
  verifyInternalAuth,
  type StorageBucket,
} from './_storage'
import { authMiddleware, rateLimiter, sharedRateLimiter, securityHeaders } from './_middleware'

const upload = multer({
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024, // 单文件上限（默认 25MB，MAX_UPLOAD_MB 可调）
    files: 2, // 最多 2 个文件（主图 + 缩略图）
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片类型
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只允许上传图片文件'))
    }
  },
})
const app = express()

const requestConfig = {
  timeout: 5000,
  headers: {
    Accept: 'image/*, */*',
    'User-Agent': 'Edgeone-Imgbed/1.6.0 (+https://github.com/Jacky088/Edgeone-Imgbed)',
  },
}
const BASE_URL = 'https://cnb.cool/' + process.env.SLUG_IMG + '/-/imgs/'

// 启动时校验关键环境变量：缺失时打清晰日志（不打印密钥本身），避免上传时报含糊错误
for (const key of ['SLUG_IMG', 'TOKEN_IMG']) {
  if (!process.env[key]) {
    console.error(`[Config] 缺少环境变量 ${key}：CNB 图片上传/代理将不可用（不影响 S3 存储），请在 EdgeOne 控制台补齐后重新部署`)
  }
}
if (!process.env.BASE_IMG_URL) {
  console.error('[Config] 缺少环境变量 BASE_IMG_URL：上传返回的链接域名将为空，S3 多存储配置也无法读取，请补齐后重新部署')
}
if (!process.env.AUTH_SECRET) {
  console.error('[Config] 未设置 AUTH_SECRET：多存储桶功能的内部接口不可用（S3 桶将无法使用，CNB 不受影响）。建议设置为随机长字符串')
}

// 解析 JSON body
app.use(express.json({ limit: '1mb' })) // 限制 JSON body 大小

// 安全头
app.use(securityHeaders)

// 多存储上传：目标后端 = 请求 storage 参数（顶栏下拉的本机选择，服务端校验）> 全局默认后端
// 返回统一 { url, assets }；S3 的 assets.path 为带标记路径（s3-{id}/{key}），与 CNB 的 assets.path 同构
// 配置了空间配额的桶：服务端强制校验（已用 + 本次 > 配额 → 拒绝上传）
// S3 key 由服务端加唯一前缀：客户端文件名仅清洗不去重，裸用会同名互相覆盖且叠加 immutable 缓存
async function uploadOneImage(buffer: Buffer, fileName: string, contentType: string, requestedStorage?: string) {
  const backend = await getActiveBackend(requestedStorage)
  if (backend.kind === 'cnb') {
    const result = await uploadToCnb({ fileBuffer: buffer, fileName })
    return { url: buildPublicUrl(result.url), assets: result.assets }
  }
  const quotaError = await checkQuotaForUpload(backend.cfg, buffer.length)
  if (quotaError) throw new Error(quotaError)
  const uniqueKey = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}-${fileName}`
  try {
    await s3PutObject(toS3Config(backend.cfg), uniqueKey, buffer, contentType)
  } catch (e) {
    releasePendingBytes(backend.cfg.id, buffer.length)
    throw e
  }
  confirmPendingBytes(backend.cfg.id, buffer.length)
  const path = `s3-${backend.cfg.id}/${uniqueKey}`
  return { url: buildPublicUrl(path), assets: { path } }
}

// 全局中间件处理所有请求
app.use((req, res, next) => {
  // 图片代理为高频路径，访问日志仅在 DEBUG_LOG=1 时输出，避免日志量随图片流量线性膨胀
  if (req.url && req.url.startsWith('/img/')) {
    if (process.env.DEBUG_LOG) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    }
    return rateLimiter(120, 60000)(req, res, () => {
      // 多存储分流：按路径标记路由到 CNB 或对应 S3 桶（标记规则见 _storage.ts）
      const fullPath = req.path || req.url || ''
      const match = fullPath.match(/\/img\/(.+)/)
      const urlPath = match ? match[1] : ''
      if (!urlPath || urlPath.includes('..') || urlPath.includes('\\') || urlPath.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid image path' })
      }
      // 扩展名白名单与上传侧一致（SVG 可内嵌脚本，不放行）
      if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(urlPath)) {
        return res.status(403).json({ error: 'Forbidden file type' })
      }
      const parsed = parseStoragePath(urlPath)
      if (parsed.storage === 'cnb') {
        return createProxyHandler(BASE_URL, requestConfig, req, res)
      }
      return (async () => {
        const doc = await getStorageConfig()
        const bucket = findBucket(doc, parsed.id)
        if (!bucket) {
          return res.status(404).json({ error: 'Storage bucket not found' })
        }
        let key = parsed.key
        try {
          key = decodeURIComponent(key)
        } catch {
          // 保留原样
        }
        return proxyS3Request(bucket, key, res)
      })()
    })
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express on Node Functions!' })
})

// 前端免登录判定：未设 SITE_PASSWORD 时 passwordEnabled=false，路由守卫自动放行
app.get('/auth/status', (_req: any, res: any) => {
  res.json(reply(0, '获取成功', { passwordEnabled: !!process.env.SITE_PASSWORD }))
})

// 身份验证接口（每分钟最多 5 次尝试，防止密码暴力破解；共享限流跨实例生效）
app.post(
  '/auth/verify',
  // 每分钟最多 5 次尝试，防止密码暴力破解
  sharedRateLimiter(5, 60000),
  (req, res) => {
  const { password, remember } = req.body
  // 获取环境变量中的密码
  const sysPassword = process.env.SITE_PASSWORD

  // 如果未设置环境变量，默认开放访问
  if (!sysPassword) {
    return res.json(reply(0, '未设置密码，开放访问', { token: 'open-access' }))
  }

  if (typeof password === 'string' && securePasswordCompare(password, sysPassword)) {
    // 签发带 HMAC 签名和过期时间的 token；勾选记住我时延长到 7 天
    return res.json(reply(0, '验证通过', { token: signAuthToken(remember === true) }))
  } else {
    return res.status(403).json(reply(403, '口令错误', null))
  }
})

app.post(
  '/upload/img',
  sharedRateLimiter(UPLOAD_RATE_LIMIT, 60000), // 上传限流可配（UPLOAD_RATE_LIMIT，默认 120/分钟，覆盖批量上传场景；跨实例共享计数）
  authMiddleware, // 添加身份验证
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req: any, res: any) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] }
      if (!files || !files.file) {
        return res.status(400).json(reply(1, '未上传文件', ''))
      }

      const mainFile = files.file?.[0]
      const thumbnailFile = files.thumbnail?.[0]

      // 验证文件类型
      if (!ALLOWED_MIMES.includes(mainFile.mimetype)) {
        return res.status(400).json(reply(1, '不支持的文件类型', ''))
      }

      // 验证文件头（magic bytes）：Content-Type 可伪造，必须校验真实内容
      if (!detectImageMime(mainFile.buffer)) {
        return res.status(400).json(reply(1, '文件内容不是有效的图片', ''))
      }
      if (thumbnailFile && !detectImageMime(thumbnailFile.buffer)) {
        return res.status(400).json(reply(1, '缩略图内容不是有效的图片', ''))
      }

      mainFile.originalname = sanitizeFilename(fixMulterFilename(mainFile.originalname))
      if (thumbnailFile) {
        thumbnailFile.originalname = sanitizeFilename(fixMulterFilename(thumbnailFile.originalname))
      }

      // 上传目标：multipart 的 storage 文本字段（顶栏下拉本机选择）；缺省走全局默认
      const requestedStorage = typeof req.body?.storage === 'string' ? req.body.storage : undefined

      // 上传主图（按目标后端路由）
      const main = await uploadOneImage(mainFile.buffer, mainFile.originalname, mainFile.mimetype, requestedStorage)

      let thumbnailUrl = null
      let thumbnailAssets = null

      // 上传缩略图
      if (thumbnailFile) {
        const thumb = await uploadOneImage(thumbnailFile.buffer, thumbnailFile.originalname, thumbnailFile.mimetype, requestedStorage)
        thumbnailUrl = thumb.url
        thumbnailAssets = thumb.assets
      }

      res.json(
        reply(0, '上传成功', {
          url: main.url,
          thumbnailUrl: thumbnailUrl,
          assets: main.assets,
          thumbnailAssets: thumbnailAssets,
          hasThumbnail: !!thumbnailFile,
          maxUploadMb: MAX_UPLOAD_MB,
        }),
      )
    } catch (err: any) {
      // 具体原因直达前端（S3 驱动错误信息已做脱敏），便于多存储场景在线诊断
      console.error('上传失败:', err?.message)
      res.status(500).json(reply(1, `上传失败：${err?.message || '请稍后重试'}`, null))
    }
  },
)

// PicGo 等第三方工具上传：使用长效 API Token 走 Basic Auth
// （export default app 移至文件末尾：所有路由注册完成后再导出）
// 配置方式：PicGo 自定义 WebUploader，POST multipart 字段 file 到 {域名}/api/upload/img
// Authorization: Basic base64(api:<PICGO_TOKEN>)，PICGO_TOKEN 为环境变量
app.post(
  '/upload/picgo',
  sharedRateLimiter(UPLOAD_RATE_LIMIT, 60000),
  (req, res, next) => {
    const picgoToken = process.env.PICGO_TOKEN
    if (!picgoToken) {
      return res.status(404).json(reply(1, '未启用 API Token（需设置 PICGO_TOKEN 环境变量）', null))
    }
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Basic ')) {
      return res.status(401).json(reply(401, '缺少 Basic 认证', null))
    }
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
      // 约定用户名为 "api"，密码为 PICGO_TOKEN
      const idx = decoded.indexOf(':')
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded
      const pass = idx >= 0 ? decoded.slice(idx + 1) : ''
      if (user !== 'api' || !securePasswordCompare(pass, picgoToken)) {
        return res.status(401).json(reply(401, 'API Token 无效', null))
      }
      return next()
    } catch {
      return res.status(401).json(reply(401, '认证头解析失败', null))
    }
  },
  upload.single('file'),
  async (req: any, res: any) => {
    try {
      const file: Express.Multer.File | undefined = req.file
      if (!file) {
        return res.status(400).json(reply(1, '未上传文件', null))
      }
      if (!ALLOWED_MIMES.includes(file.mimetype) || !detectImageMime(file.buffer)) {
        return res.status(400).json(reply(1, '不支持的文件类型', null))
      }

      file.originalname = sanitizeFilename(fixMulterFilename(file.originalname))

      const main = await uploadOneImage(file.buffer, file.originalname, file.mimetype)

      // PicGo 期望 { success: true, result: [url] } 格式
      return res.json({ success: true, result: [main.url] })
    } catch (err: any) {
      console.error('PicGo 上传失败:', err?.message)
      res.status(500).json({ success: false, message: `上传失败：${err?.message || '请稍后重试'}` })
    }
  },
)

// 前端展示用：当前存储信息（桶名非密钥可返回；仍需登录态，避免未授权探测）
// bucket = 当前默认后端的展示名；storages = 可选后端清单（设置页/前端展示用）
// 前端展示用：当前存储信息（桶名非密钥可返回；仍需登录态，避免未授权探测）
// bucket = 当前默认后端的展示名（切换后随之变化）；active/storages 供前端展示可选后端
// 强制拉最新桶配置：顶栏徽标/下拉必须即时反映设置页的默认切换与增删桶
app.get('/config', authMiddleware, async (_req: any, res: any) => {
  // 一次内部取数：stats 非强制读，命中上一次 force 拉取写入的 5s 缓存（避免 N+1）
  const doc = await getStorageConfig(true)
  const stats = await getStorageStats()
  const active = doc?.active || 'cnb'
  const activeBucket = active === 'cnb' ? null : findBucket(doc, active)
  res.json(reply(0, '获取成功', {
    bucket: active === 'cnb' ? process.env.SLUG_IMG || '' : activeBucket?.bucket || '',
    cnbBucket: process.env.SLUG_IMG || '',
    passwordEnabled: !!process.env.SITE_PASSWORD,
    maxUploadMb: MAX_UPLOAD_MB,
    active,
    // 按桶累计上传统计（记录派生）；配额随 storages 下发（非密钥）
    stats,
    storages: [
      { id: 'cnb', label: 'CNB 对象存储', type: 'cnb', quotaBytes: null },
      ...(doc?.buckets || []).map((b: StorageBucket) => ({ id: b.id, label: b.label, type: 's3', quotaBytes: b.quotaBytes ?? null })),
    ],
  }))
})

// 桶连接检测（设置页弹窗保存前调用）：凭证可直传（新增/修改），或留空复用已存凭证（编辑未改密钥时）
// 四步探测：HeadBucket → 写入探针 → 读回 → 清理，任一步失败带步骤明细返回
// 开放访问（未设 SITE_PASSWORD）模式下整体 403：该端点会向任意端点发起四步请求并回显
// 状态码/错误码，无鉴权时等于把函数的网络位置开放成探测探针
app.post(
  '/storage/test',
  authMiddleware,
  rateLimiter(10, 60000),
  async (req: any, res: any) => {
    if (!process.env.SITE_PASSWORD) {
      return res.status(403).json(reply(1, '开放访问模式下未开放存储桶管理，请先设置 SITE_PASSWORD', null))
    }
    try {
      const body = req.body || {}
      let accessKeyId = typeof body.accessKeyId === 'string' ? body.accessKeyId.trim() : ''
      let secretAccessKey = typeof body.secretAccessKey === 'string' ? body.secretAccessKey.trim() : ''
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
      const bucket = typeof body.bucket === 'string' ? body.bucket.trim() : ''
      const region = typeof body.region === 'string' ? body.region.trim() : 'us-east-1'
      const pathStyle = body.pathStyle !== false

      // 桶名白名单与保存侧一致：防止 ../、?、# 等拼进请求路径做同主机路径探测
      if (bucket && !/^[\w.-]{1,255}$/.test(bucket)) {
        return res.status(400).json(reply(1, '桶名不合法', null))
      }

      // 编辑场景：密钥留空 = 沿用已存凭证（客户端不持有密钥，从配置文档回填）
      if ((!accessKeyId || !secretAccessKey) && body.id) {
        const doc = await getStorageConfig(true)
        const stored = findBucket(doc, String(body.id))
        if (!stored) {
          return res.status(404).json(reply(1, '要检测的存储桶不存在', null))
        }
        accessKeyId = accessKeyId || stored.accessKeyId
        secretAccessKey = secretAccessKey || stored.secretAccessKey
      }

      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return res.status(400).json(reply(1, '缺少端点、桶名或访问密钥', null))
      }

      const probe = await s3ProbeBucket({
        id: String(body.id || 'probe'),
        endpoint,
        bucket,
        region: region || 'us-east-1',
        pathStyle,
        accessKeyId,
        secretAccessKey,
      })
      return res.json(reply(probe.ok ? 0 : 1, probe.ok ? '连接成功' : '连接失败', probe))
    } catch (err: any) {
      return res.json(reply(1, err?.message || '检测失败', { ok: false, steps: [], ms: 0 }))
    }
  },
)

// CNB 真实容量探测：组织用量/额度（Charge API）+ 各 S3 桶用量（上传记录聚合）。
// CNB 令牌无 group-resource:r 权限或上游异常时 cnb.available=false，前端按回退逻辑展示，不当作错误。
// S3 桶无配额概念，仅汇总已用体积与对象数；配额随桶配置下发，未设时前端显示 ♾️。
app.get(
  '/storage/usage',
  authMiddleware,
  rateLimiter(30, 60000),
  async (req: any, res: any) => {
    // refresh=1 绕过 10 分钟缓存（孤儿清理后立即刷新）
    const force = req.query?.refresh === '1'
    const [cnb, doc, stats] = await Promise.all([
      fetchCnbStorageUsage(force),
      getStorageConfig(force),
      getStorageStats(force),
    ])
    // 上下文一次取齐复用，避免每桶各打一次内部端点（N+1）
    const backends = (doc?.buckets || []).map((b: StorageBucket) => {
      const s = stats[b.id]
      return {
        id: b.id,
        label: b.label,
        available: true,
        usedBytes: s?.size ?? 0,
        count: s?.count ?? 0,
        quotaBytes: b.quotaBytes ?? null,
      }
    })
    const cnbPart = cnb.available
      ? { available: true, ...cnb.data }
      : { available: false, reason: cnb.reason || 'unknown', detail: cnb.detail }
    res.json(reply(0, '获取成功', { cnb: cnbPart, backends }))
  },
)

// 跨存储源文件删除：按 URL/路径中的存储标记路由（CNB → 官方删除接口；S3 → 桶 DeleteObjects）。
// 前端传记录 URL（主图+缩略图），服务端提取标记路径后分组删除。
// 尽力而为：删除失败不影响记录已删除的事实（孤儿文件由各自存储的扫描兜底）
app.post(
  ['/file/delete', '/file/delete-cnb'],
  authMiddleware,
  rateLimiter(30, 60000),
  async (req: any, res: any) => {
    // urls：记录链接（服务端提取标记路径）；paths：直传标记路径（孤儿文件清理）
    const urls = Array.isArray(req.body?.urls)
      ? req.body.urls.filter((u: unknown) => typeof u === 'string')
      : []
    const paths = Array.isArray(req.body?.paths)
      ? req.body.paths.filter((p: unknown) => typeof p === 'string')
      : []
    if (urls.length === 0 && paths.length === 0) {
      return res.status(400).json(reply(1, '缺少 urls 或 paths 参数', null))
    }
    if (urls.length + paths.length > 50) {
      return res.status(400).json(reply(1, '单次最多删除 50 个文件', null))
    }
    const result = await deleteAcrossStorages(urls, paths)
    res.json(reply(0, '处理完成', result))
  },
)

// 内部端点：边缘函数（记录清理 purge）委托删除 S3 源文件。
// 以 x-internal-auth HMAC 头鉴权（与 node→edge 读配置同一套互信），不对公网暴露
app.post('/file/delete-internal', async (req: any, res: any) => {
  if (!verifyInternalAuth(req.headers['x-internal-auth'])) {
    return res.status(401).json(reply(401, '内部鉴权失败', null))
  }
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter((u: unknown) => typeof u === 'string') : []
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter((p: unknown) => typeof p === 'string') : []
  if (urls.length === 0 && paths.length === 0) {
    return res.status(400).json(reply(1, '缺少 urls 或 paths 参数', null))
  }
  if (urls.length + paths.length > 100) {
    return res.status(400).json(reply(1, '单次最多删除 100 个文件', null))
  }
  const result = await deleteAcrossStorages(urls, paths)
  res.json(reply(0, '处理完成', result))
})

// 未知 /api 路由兜底：统一返回 JSON（code/msg/data 约定），避免 Express 默认 HTML 404
// 注意：新增路由必须注册在这两个中间件之前，否则会被 404 兜底吞掉
app.use((_req: any, res: any) => {
  res.status(404).json(reply(1, '接口不存在', null))
})

// 上传错误统一 JSON 处理：multer 限流/类型拒绝默认会走 Express HTML 错误页
app.use((err: any, _req: any, res: any, _next: (_e: unknown) => void) => {
  console.error('API 错误:', err?.message || err)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(reply(1, `文件超过 ${MAX_UPLOAD_MB}MB 上限`, null))
    }
    return res.status(400).json(reply(1, '文件上传失败', null))
  }
  if (err?.message === '只允许上传图片文件') {
    return res.status(400).json(reply(1, '只允许上传图片文件', null))
  }
  res.status(500).json(reply(1, '上传失败，请稍后重试', null))
})

export default app
