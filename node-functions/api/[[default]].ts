import express from 'express'
import { uploadToCnb, createProxyHandler } from './_utils'
import { reply } from './_reply'
import { store, type ImageRecord } from './_store'
import multer from 'multer'

const upload = multer()
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
app.use(express.json())

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
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

// 管理接口：获取图片列表
app.get('/admin/list', (req, res) => {
  const list = store.getAll()
  res.json(reply(0, '获取成功', list))
})

// 管理接口：删除图片 (仅删除记录)
app.post('/admin/delete', (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(reply(1, 'ID不能为空', null))

  store.remove(id)
  res.json(reply(0, '删除成功', null))
})

// 代理路由保持不变，它自然会响应 /api/img/... 的请求
app.get('/img/*path', createProxyHandler(BASE_URL, requestConfig))

app.post(
  '/upload/img',
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
      const record: ImageRecord = {
        id: crypto.randomUUID(),
        name: mainFile.originalname,
        url: mainUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        size: mainFile.size,
        type: mainFile.mimetype,
        createdAt: Date.now(),
      }
      store.add(record)

      res.json(
        reply(0, '上传成功', {
          url: mainUrl,
          thumbnailUrl: thumbnailUrl,
          assets: mainResult.assets,
          thumbnailAssets: thumbnailAssets,
          hasThumbnail: !!thumbnailFile,
        }),
      )
    } catch (err) {
      console.error('上传失败:', err.response?.data || err.message)
      res.status(500).json(reply(1, '上传失败', err.message))
    }
  },
)

/**
 * 从 URL 中提取图片路径
 */
function extractImagePath(url) {
  if (url.includes('-/imgs/')) {
    return url.split('-/imgs/')[1]
  } else if (url.includes('-/files/')) {
    return url.split('-/files/')[1]
  }
  return url
}

export default app
