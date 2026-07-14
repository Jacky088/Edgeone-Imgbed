import express from 'express'
import { uploadToCnb, createProxyHandler } from './_utils'
import { reply } from './_reply'
import multer from 'multer'

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

// 简单的速率限制器（内存版）
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function rateLimiter(maxRequests: number = 20, windowMs: number = 60000) {
  return (req: any, res: any, next: any) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'
    const now = Date.now()

    const record = rateLimitMap.get(ip)

    if (!record || now > record.resetTime) {
      // 新记录或已过期
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
      return next()
    }

    if (record.count >= maxRequests) {
      return res.status(429).json(reply(429, '请求过于频繁，请稍后再试', null))
    }

    record.count++
    next()
  }
}

// 清理过期的速率限制记录
setInterval(() => {
  const now = Date.now()
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip)
    }
  }
}, 60000) // 每分钟清理一次

// 身份验证中间件
function authMiddleware(req: any, res: any, next: any) {
  const sysPassword = process.env.SITE_PASSWORD

  // 如果未设置密码，则不需要验证
  if (!sysPassword) {
    return next()
  }

  // 检查 Authorization header
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(reply(401, '未授权访问', null))
  }

  const token = authHeader.substring(7)

  // 简单的 token 验证（生产环境应使用 JWT 或类似方案）
  if (token === 'authorized') {
    return next()
  }

  return res.status(401).json(reply(401, '无效的访问令牌', null))
}

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

// 安全头中间件
app.use((req, res, next) => {
  // 防止点击劫持
  res.setHeader('X-Frame-Options', 'DENY')
  // 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // XSS 保护
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // HTTPS 强制
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // 内容安全策略
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  )
  next()
})

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

// [新增] 身份验证接口
app.post('/auth/verify', (req, res) => {
  const { password } = req.body
  // 获取环境变量中的密码
  const sysPassword = process.env.SITE_PASSWORD

  // 如果未设置环境变量，默认开放访问
  if (!sysPassword) {
    return res.json(reply(0, '未设置密码，开放访问', { token: 'open-access' }))
  }

  if (password === sysPassword) {
    return res.json(reply(0, '验证通过', { token: 'authorized' }))
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

      // [修改点 1] 处理 Base URL 拼接
      let baseUrl = process.env.BASE_IMG_URL || ''
      // 移除末尾可能存在的斜杠，保证格式统一
      if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1)
      }

      const mainImgPath = extractImagePath(mainResult.url)

      // [修改点 2] 强制拼接 /api/img/ 路径
      // 结果形如: https://你的域名.com/api/img/文件名.webp
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
        // [修改点 3] 缩略图也同样强制拼接
        thumbnailUrl = `${baseUrl}/api/img/${thumbnailImgPath}`
        thumbnailAssets = thumbnailResult.assets
      }

      // 保存上传记录
      const record = {
        id: crypto.randomUUID(),
        name: mainFile.originalname,
        url: mainUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        size: mainFile.size,
        type: mainFile.mimetype,
        createdAt: Date.now(),
      }

      // KV 仅能在 Edge Functions 中访问，因此通过同站点的 Edge Function 保存记录。
      // 记录保存失败不影响已经完成的图片上传，但会在响应中明确提示。
      let recordSaved = false
      try {
        if (!baseUrl) throw new Error('BASE_IMG_URL 未配置')
        const recordResponse = await fetch(`${baseUrl}/image-records`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer authorized',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(record),
        })
        recordSaved = recordResponse.ok
        if (!recordResponse.ok) {
          console.error('保存图片记录失败:', await recordResponse.text())
        }
      } catch (recordError) {
        console.error('保存图片记录失败:', recordError)
      }

      res.json(
        reply(0, '上传成功', {
          url: mainUrl,
          thumbnailUrl: thumbnailUrl,
          assets: mainResult.assets,
          thumbnailAssets: thumbnailAssets,
          hasThumbnail: !!thumbnailFile,
          recordSaved,
        }),
      )
    } catch (err: any) {
      console.error('上传失败:', err.response?.data || err.message)
      res.status(500).json(reply(1, '上传失败', err.message))
    }
  },
)

/**
 * 从 URL 中提取图片路径
 */
function extractImagePath(url: string): string {
  if (url.includes('-/imgs/')) {
    return url.split('-/imgs/')[1]
  } else if (url.includes('-/files/')) {
    return url.split('-/files/')[1]
  }
  return url
}

export default app
