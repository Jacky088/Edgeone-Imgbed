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
  responseType: 'arraybuffer',
  timeout: 5000,
  headers: {
    Accept: 'image/*, */*',
    'User-Agent': 'SeerImageProxy/1.0 (+https://seerinfo.yuyuqaq.cn)',
  },
}
const BASE_URL = 'https://cnb.cool/' + process.env.SLUG_IMG + '/-/imgs/'

// 解析 JSON body
app.use(express.json({ limit: '1mb' })) // 限制 JSON body 大小

// 安全头
app.use(securityHeaders)

// 全局中间件处理所有请求
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)

  // 如果是图片代理请求，直接处理
  if (req.url && req.url.startsWith('/img/')) {
    const handler = createProxyHandler(BASE_URL, requestConfig)
    return handler(req, res)
  }

  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express on Node Functions!' })
})

// 身份验证接口（每分钟最多 5 次尝试，防止密码暴力破解）
app.post('/auth/verify', rateLimiter(5, 60000), (req, res) => {
  const { password } = req.body
  // 获取环境变量中的密码
  const sysPassword = process.env.SITE_PASSWORD

  // 如果未设置环境变量，默认开放访问
  if (!sysPassword) {
    return res.json(reply(0, '未设置密码，开放访问', { token: 'open-access' }))
  }

  if (typeof password === 'string' && securePasswordCompare(password, sysPassword)) {
    // 签发带 HMAC 签名和过期时间的 token，替代固定字符串
    return res.json(reply(0, '验证通过', { token: signAuthToken() }))
  } else {
    return res.status(403).json(reply(403, '口令错误', null))
  }
})

app.post(
  '/upload/img',
  rateLimiter(10, 60000), // 每分钟最多 10 次上传
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

      // 验证文件名，防止路径遍历
      const sanitizeFilename = (filename: string) => {
        return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      }

      mainFile.originalname = sanitizeFilename(mainFile.originalname)
      if (thumbnailFile) {
        thumbnailFile.originalname = sanitizeFilename(thumbnailFile.originalname)
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

export default app
