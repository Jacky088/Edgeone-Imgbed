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
  deleteFromCnb,
  MAX_UPLOAD_MB,
  UPLOAD_RATE_LIMIT,
  ALLOWED_MIMES,
} from './_utils'
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
    console.error(`[Config] 缺少环境变量 ${key}：图片上传/代理将不可用，请在 EdgeOne 控制台补齐后重新部署`)
  }
}
if (!process.env.BASE_IMG_URL) {
  console.error('[Config] 缺少环境变量 BASE_IMG_URL：上传返回的链接域名将为空，请补齐后重新部署')
}

// 解析 JSON body
app.use(express.json({ limit: '1mb' })) // 限制 JSON body 大小

// 安全头
app.use(securityHeaders)

// 全局中间件处理所有请求
app.use((req, res, next) => {
  // 图片代理为高频路径，访问日志仅在 DEBUG_LOG=1 时输出，避免日志量随图片流量线性膨胀
  if (req.url && req.url.startsWith('/img/')) {
    if (process.env.DEBUG_LOG) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    }
    return rateLimiter(120, 60000)(req, res, () => {
      createProxyHandler(BASE_URL, requestConfig, req, res)
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

      // 上传主图
      const mainResult = await uploadToCnb({
        fileBuffer: mainFile.buffer,
        fileName: mainFile.originalname,
      })

      const mainUrl = buildPublicUrl(mainResult.url)

      let thumbnailUrl = null
      let thumbnailAssets = null

      // 上传缩略图
      if (thumbnailFile) {
        const thumbnailResult = await uploadToCnb({
          fileBuffer: thumbnailFile.buffer,
          fileName: thumbnailFile.originalname,
        })

        thumbnailUrl = buildPublicUrl(thumbnailResult.url)
        thumbnailAssets = thumbnailResult.assets
      }

      res.json(
        reply(0, '上传成功', {
          url: mainUrl,
          thumbnailUrl: thumbnailUrl,
          assets: mainResult.assets,
          thumbnailAssets: thumbnailAssets,
          hasThumbnail: !!thumbnailFile,
          maxUploadMb: MAX_UPLOAD_MB,
        }),
      )
    } catch (err: any) {
      // 详细错误只写日志，不向客户端泄露内部信息（如上游 URL、API 细节）
      console.error('上传失败:', err.response?.data || err.message)
      res.status(500).json(reply(1, '上传失败，请稍后重试', null))
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

      const mainResult = await uploadToCnb({
        fileBuffer: file.buffer,
        fileName: file.originalname,
      })

      const mainUrl = buildPublicUrl(mainResult.url)

      // PicGo 期望 { success: true, result: [url] } 格式
      return res.json({ success: true, result: [mainUrl] })
    } catch (err: any) {
      console.error('PicGo 上传失败:', err.response?.data || err.message)
      res.status(500).json({ success: false, message: '上传失败，请稍后重试' })
    }
  },
)

// 前端展示用：当前存储桶名（SLUG_IMG 非密钥可返回；仍需登录态，避免未授权探测）
app.get('/config', authMiddleware, (_req: any, res: any) => {
  res.json(reply(0, '获取成功', {
    bucket: process.env.SLUG_IMG || '',
    passwordEnabled: !!process.env.SITE_PASSWORD,
    maxUploadMb: MAX_UPLOAD_MB,
  }))
})

// CNB 真实容量探测：组织用量/额度（Charge API）。
// 令牌无 group-resource:r 权限或上游异常时返回 available:false，前端按回退逻辑展示，不当作错误
app.get(
  '/storage/usage',
  authMiddleware,
  rateLimiter(30, 60000),
  async (req: any, res: any) => {
    // refresh=1 绕过 10 分钟缓存（孤儿清理后立即刷新）
    const result = await fetchCnbStorageUsage(req.query?.refresh === '1')
    if (!result.available) {
      return res.json(
        reply(0, 'CNB 容量接口不可用', {
          available: false,
          reason: result.reason || 'unknown',
          detail: result.detail,
        }),
      )
    }
    res.json(reply(0, '获取成功', { available: true, ...result.data }))
  },
)

// 彻底删除时联动删除 CNB 源文件：前端传记录 URL（主图+缩略图），服务端提取 imgPath 后调用
// CNB 删除接口（需令牌具备 repo-manage:rw 权限）。尽力而为：删除失败不影响记录已删除的事实
app.post(
  '/file/delete-cnb',
  authMiddleware,
  rateLimiter(30, 60000),
  async (req: any, res: any) => {
    // urls：记录链接（服务端提取 imgPath）；paths：直传 imgPath（孤儿文件清理）
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
    const result = await deleteFromCnb(urls, paths)
    res.json(reply(0, '处理完成', result))
  },
)

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
