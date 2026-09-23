import express from 'express'
import multer from 'multer'
import { reply } from './_reply'
import {
  uploadToCnb,
  createProxyHandler,
  detectImageMime,
  extractImagePath,
  securePasswordCompare,
  signAuthToken,
} from './_utils'
import { authMiddleware, rateLimiter, securityHeaders } from './_middleware'

const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 限制
    files: 2, // 最多 2 个文件（主图 + 缩略图）
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片类型
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (allowedMimes.includes(file.mimetype)) {
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
    'User-Agent': 'SeerImageProxy/1.0 (+https://seerinfo.yuyuqaq.cn)',
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
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)

  // 如果是图片代理请求，直接处理（createProxyHandler 为模块级单例，无请求级闭包）
  if (req.url && req.url.startsWith('/img/')) {
    return createProxyHandler(BASE_URL, requestConfig, req, res)
  }

  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express on Node Functions!' })
})

// 身份验证接口（每分钟最多 5 次尝试，防止密码暴力破解）
app.post('/auth/verify', rateLimiter(5, 60000), (req, res) => {
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
  rateLimiter(30, 60000), // 每分钟最多 30 次上传（批量上传场景）
  authMiddleware, // 添加身份验证
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] }
      if (!files || !files.file) {
        return res.status(400).json(reply(1, '未上传文件', ''))
      }

      const mainFile = files.file?.[0]
      const thumbnailFile = files.thumbnail?.[0]

      // 验证文件类型
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      if (!allowedMimes.includes(mainFile.mimetype)) {
        return res.status(400).json(reply(1, '不支持的文件类型', ''))
      }

      // 验证文件头（magic bytes）：Content-Type 可伪造，必须校验真实内容
      if (!detectImageMime(mainFile.buffer)) {
        return res.status(400).json(reply(1, '文件内容不是有效的图片', ''))
      }
      if (thumbnailFile && !detectImageMime(thumbnailFile.buffer)) {
        return res.status(400).json(reply(1, '缩略图内容不是有效的图片', ''))
      }

      // 修复 multer/busboy 将 UTF-8 文件名按 latin1 解码导致的中文乱码
      const fixMulterFilename = (name: string): string => {
        try {
          const decoded = Buffer.from(name, 'latin1').toString('utf8')
          // 解码失败（出现替换符）则保留原名
          if (decoded && !decoded.includes('\uFFFD')) return decoded
        } catch {
          // ignore
        }
        return name
      }

      // 验证文件名，防止路径遍历：保留 Unicode 字母数字（含中文），其余替换为下划线
      const sanitizeFilename = (filename: string) => {
        const cleaned = filename.replace(/[^\p{L}\p{N}._-]/gu, '_')
        return cleaned.length > 100 ? cleaned.slice(0, 100) : cleaned
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
      // 处理 Base URL 拼接：移除末尾斜杠，保证格式统一
      let baseUrl = process.env.BASE_IMG_URL || ''
      if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1)
      }

      const mainImgPath = extractImagePath(mainResult.url)

      // 强制拼接 /api/img/ 路径，结果形如: https://你的域名.com/api/img/文件名.webp
      const mainUrl = `${baseUrl}/api/img/${mainImgPath}`

      let thumbnailUrl = null
      let thumbnailAssets = null

      // 上传缩略图
      if (thumbnailFile) {
        const thumbnailResult = await uploadToCnb({
          fileBuffer: thumbnailFile.buffer,
          fileName: thumbnailFile.originalname,
        })

        const thumbnailImgPath = extractImagePath(thumbnailResult.url)
        thumbnailUrl = `${baseUrl}/api/img/${thumbnailImgPath}`
        thumbnailAssets = thumbnailResult.assets
      }

      res.json(
        reply(0, '上传成功', {
          url: mainUrl,
          thumbnailUrl: thumbnailUrl,
          assets: mainResult.assets,
          thumbnailAssets: thumbnailAssets,
          hasThumbnail: !!thumbnailFile,
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
  rateLimiter(30, 60000),
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
  async (req: any, res) => {
    try {
      const file: Express.Multer.File | undefined = req.file
      if (!file) {
        return res.status(400).json(reply(1, '未上传文件', null))
      }
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      if (!allowedMimes.includes(file.mimetype) || !detectImageMime(file.buffer)) {
        return res.status(400).json(reply(1, '不支持的文件类型', null))
      }

      const fixMulterFilename = (name: string): string => {
        try {
          const decoded = Buffer.from(name, 'latin1').toString('utf8')
          if (decoded && !decoded.includes('\uFFFD')) return decoded
        } catch {
          // ignore
        }
        return name
      }
      const sanitizeFilename = (filename: string) => {
        const cleaned = filename.replace(/[^\p{L}\p{N}._-]/gu, '_')
        return cleaned.length > 100 ? cleaned.slice(0, 100) : cleaned
      }
      file.originalname = sanitizeFilename(fixMulterFilename(file.originalname))

      const mainResult = await uploadToCnb({
        fileBuffer: file.buffer,
        fileName: file.originalname,
      })

      let baseUrl = process.env.BASE_IMG_URL || ''
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
      const mainUrl = `${baseUrl}/api/img/${extractImagePath(mainResult.url)}`

      // PicGo 期望 { success: true, result: [url] } 格式
      return res.json({ success: true, result: [mainUrl] })
    } catch (err: any) {
      console.error('PicGo 上传失败:', err.response?.data || err.message)
      res.status(500).json({ success: false, message: '上传失败，请稍后重试' })
    }
  },
)

// 未知 /api 路由兜底：统一返回 JSON（code/msg/data 约定），避免 Express 默认 HTML 404
// 注意：新增路由必须注册在这两个中间件之前，否则会被 404 兜底吞掉
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((_req: any, res: any) => {
  res.status(404).json(reply(1, '接口不存在', null))
})

// 上传错误统一 JSON 处理：multer 限流/类型拒绝默认会走 Express HTML 错误页
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: (_e: unknown) => void) => {
  console.error('API 错误:', err?.message || err)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(reply(1, '文件超过 5MB 上限', null))
    }
    return res.status(400).json(reply(1, '文件上传失败', null))
  }
  if (err?.message === '只允许上传图片文件') {
    return res.status(400).json(reply(1, '只允许上传图片文件', null))
  }
  res.status(500).json(reply(1, '上传失败，请稍后重试', null))
})

export default app
