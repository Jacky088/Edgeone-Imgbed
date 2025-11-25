import express from 'express'
import { createProxyHandler } from './_utils' // 只保留 createProxyHandler
import { reply } from './_reply'
import { store, type ImageRecord } from './_store'
import multer from 'multer'
// [新增] 引入新模块，专门处理物理存储
import { uploadToGenericPackage, deleteFromGenericPackage, getGenericPackageBaseUrl } from './_cnb_api'
// [新增] 引入 crypto 生成唯一ID
import crypto from 'crypto'
import path from 'path'

const upload = multer()
const app = express()

const requestConfig = {
  responseType: 'arraybuffer',
  timeout: 10000,
  headers: {
    // 如果仓库是私有的，必须带 Token
    'Authorization': `Bearer ${process.env.TOKEN_IMG}`, 
    'User-Agent': 'ImgBed-Proxy/2.0',
  },
}

// [修改] 现在的远程 Base URL 变成了制品库地址
const BASE_URL = getGenericPackageBaseUrl()

app.use(express.json())

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express on Node Functions!' })
})

app.post('/auth/verify', (req, res) => {
  const { password } = req.body
  const sysPassword = process.env.SITE_PASSWORD
  if (!sysPassword) {
    return res.json(reply(0, '未设置密码，开放访问', { token: 'open-access' }))
  }
  if (password === sysPassword) {
    return res.json(reply(0, '验证通过', { token: 'authorized' }))
  } else {
    return res.status(403).json(reply(403, '口令错误', null))
  }
})

app.get('/admin/list', (req, res) => {
  const list = store.getAll()
  res.json(reply(0, '获取成功', list))
})

// [修改] 删除接口：接入物理删除逻辑
app.post('/admin/delete', async (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(reply(1, 'ID不能为空', null))

  // 1. 查库
  const list = store.getAll()
  const target = list.find(item => item.id === id)

  if (!target) {
    // 如果数据库里没有，尝试做一次兜底删除（仅删记录）
    store.remove(id)
    return res.json(reply(0, '记录已清理(文件不存在)', null))
  }

  try {
    // 2. 执行物理删除 (Generic Package)
    // 逻辑：我们需要知道云端文件名。在新上传逻辑中，云端文件名 = id + 后缀
    // 为了稳健，我们尝试构造文件名
    const ext = path.extname(target.name) || '.png'
    const cloudFileName = `${target.id}${ext}`
    
    await deleteFromGenericPackage(cloudFileName).catch(e => {
      console.warn('物理删除主图失败(可能是旧版数据):', e.message)
    })

    // 删除缩略图
    if (target.thumbnailUrl) {
      const thumbName = `${target.id}_thumb.webp`
      await deleteFromGenericPackage(thumbName).catch(() => {})
    }

    // 3. 删除数据库记录
    store.remove(id)
    res.json(reply(0, '物理删除成功', null))

  } catch (e: any) {
    console.error('Delete Error:', e)
    res.status(500).json(reply(1, '删除失败: ' + e.message, null))
  }
})

// [修改] 路由匹配规则：兼容 /api/img/xxx
// 使用正则匹配，捕获 /img/ 之后的所有内容作为 path 参数
app.get(/^\/img\/(.+)/, (req, res) => {
  // 手动设置 params.path，供 createProxyHandler 使用
  req.params.path = req.params[0] 
  return createProxyHandler(BASE_URL, requestConfig)(req, res)
})

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

      // [修改] 生成唯一ID作为文件名 (UUID)
      // 这样做的好处是文件名可预测，方便后续删除
      const fileId = crypto.randomUUID()
      const fileExt = path.extname(mainFile.originalname) || '.png'
      const cloudMainName = `${fileId}${fileExt}`

      // [修改] 使用新的上传接口
      await uploadToGenericPackage(mainFile.buffer, cloudMainName)

      // [修改] 链接拼接逻辑
      let baseUrl = process.env.BASE_IMG_URL || ''
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)

      // 代理链接: https://域名/api/img/uuid.png
      const mainUrl = `${baseUrl}/api/img/${cloudMainName}`
      // 直连链接
      const mainUrlOriginal = `${BASE_URL}${cloudMainName}`

      let thumbnailUrl = null
      let thumbnailOriginalUrl = null

      if (thumbnailFile) {
        const cloudThumbName = `${fileId}_thumb.webp`
        await uploadToGenericPackage(thumbnailFile.buffer, cloudThumbName)
        
        thumbnailUrl = `${baseUrl}/api/img/${cloudThumbName}`
        thumbnailOriginalUrl = `${BASE_URL}${cloudThumbName}`
      }

      const record: ImageRecord = {
        id: fileId,
        name: mainFile.originalname,
        url: mainUrl,
        urlOriginal: mainUrlOriginal,
        thumbnailUrl: thumbnailUrl || undefined,
        thumbnailOriginalUrl: thumbnailOriginalUrl || undefined,
        size: mainFile.size,
        type: mainFile.mimetype,
        createdAt: Date.now(),
      }
      store.add(record)

      res.json(
        reply(0, '上传成功', {
          url: mainUrl,
          thumbnailUrl: thumbnailUrl,
          urlOriginal: mainUrlOriginal,
          thumbnailOriginalUrl: thumbnailOriginalUrl,
          // 兼容旧前端字段，防止报错
          assets: { path: '/' + cloudMainName }, 
          thumbnailAssets: { path: '/' + (thumbnailOriginalUrl ? 'thumb' : '') } 
        }),
      )
    } catch (err: any) {
      console.error('上传失败:', err.message)
      res.status(500).json(reply(1, '上传失败: ' + err.message))
    }
  },
)

export default app
