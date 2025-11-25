import express from 'express'
import { uploadToCnb, deleteFromCnb, createProxyHandler, PACKAGE_NAME, PACKAGE_VERSION } from './_utils'
import { reply } from './_reply'
import { store, type ImageRecord } from './_store'
import multer from 'multer'
import path from 'path'

const upload = multer()
const app = express()

// 制品库的读取 Base URL
// 格式: https://api.cnb.cool/<slug>/-/packages/generic/<name>/<version>/
const REMOTE_BASE_URL = `https://api.cnb.cool/${process.env.SLUG_IMG}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/`

const requestConfig = {
  timeout: 15000,
  headers: {
    // 制品库读取可能需要 Token (如果是私有仓库)
    // 如果是公开仓库，可以去掉 Authorization
    'Authorization': `Bearer ${process.env.TOKEN_IMG}`,
    'User-Agent': 'ImgBed-Proxy/2.0',
  },
}

app.use(express.json())

// 日志
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

// 身份验证
app.post('/auth/verify', (req, res) => {
  const { password } = req.body
  const sysPassword = process.env.SITE_PASSWORD
  if (!sysPassword) return res.json(reply(0, '未设置密码', { token: 'open' }))
  if (password === sysPassword) return res.json(reply(0, '验证通过', { token: 'auth' }))
  res.status(403).json(reply(403, '口令错误', null))
})

// 获取列表
app.get('/admin/list', (req, res) => {
  res.json(reply(0, 'ok', store.getAll()))
})

// [核心修改] 物理删除接口
app.post('/admin/delete', async (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json(reply(1, 'ID不能为空', null))

  // 1. 从数据库查找记录
  const list = store.getAll()
  const target = list.find(item => item.id === id)

  if (!target) {
    return res.status(404).json(reply(1, '记录不存在', null))
  }

  try {
    // 2. 物理删除远程文件
    // 我们在上传时，将 filename 存在了 record.name 里吗？
    // 不，record.name 是原始文件名，我们需要知道存在云端的文件名。
    // 在新逻辑中，云端文件名 = ID + 后缀。
    
    // 提取文件后缀
    const ext = path.extname(target.name) || '.png' 
    const cloudFileName = `${target.id}${ext}` // 主图文件名
    
    console.log(`Deleting main file: ${cloudFileName}`)
    await deleteFromCnb(cloudFileName)

    // 3. 如果有缩略图，也删除 (缩略图命名规则: ID_thumb.webp)
    if (target.thumbnailUrl) {
       const thumbFileName = `${target.id}_thumb.webp`
       console.log(`Deleting thumb file: ${thumbFileName}`)
       await deleteFromCnb(thumbFileName) // 忽略缩略图删除失败，不阻断流程
         .catch(e => console.warn('Thumb delete failed:', e))
    }

    // 4. 删除本地记录
    store.remove(id)
    
    res.json(reply(0, '物理删除成功', null))
  } catch (e) {
    console.error('删除失败:', e)
    res.status(500).json(reply(1, '物理删除失败: ' + e.message, null))
  }
})

// 代理路由
app.get('/image/:path(*)', (req, res) => {
  return createProxyHandler(REMOTE_BASE_URL, requestConfig)(req, res)
})

// 上传接口
app.post('/upload/img', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] }
    if (!files?.file?.[0]) return res.status(400).json(reply(1, '无文件', ''))

    const mainFile = files.file[0]
    const thumbFile = files.thumbnail?.[0]
    
    // [核心修改] 生成唯一 ID，作为云端文件名，方便后续删除
    const fileId = crypto.randomUUID()
    const fileExt = path.extname(mainFile.originalname) || '.png' // 获取后缀
    const cloudMainName = `${fileId}${fileExt}` // 云端文件名: uuid.jpg

    // 1. 上传主图
    await uploadToCnb({
      fileBuffer: mainFile.buffer,
      fileName: cloudMainName,
    })

    // 2. 构造链接
    let baseUrl = process.env.BASE_IMG_URL || ''
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
    
    // 代理链接: /api/image/uuid.jpg
    const mainUrl = `${baseUrl}/api/image/${cloudMainName}`
    
    // CNB 直连链接 (Generic Package 格式)
    const mainUrlOriginal = `${REMOTE_BASE_URL}${cloudMainName}`

    let thumbnailUrl = null
    let thumbnailOriginalUrl = null

    // 3. 上传缩略图
    if (thumbFile) {
      const cloudThumbName = `${fileId}_thumb.webp` // 缩略图固定 webp
      await uploadToCnb({
        fileBuffer: thumbFile.buffer,
        fileName: cloudThumbName,
      })
      thumbnailUrl = `${baseUrl}/api/image/${cloudThumbName}`
      thumbnailOriginalUrl = `${REMOTE_BASE_URL}${cloudThumbName}`
    }

    // 4. 存库
    const record: ImageRecord = {
      id: fileId, // ID 就是 uuid
      name: mainFile.originalname, // 原始文件名 (仅用于展示)
      url: mainUrl,
      urlOriginal: mainUrlOriginal, // [新增] 保存直连链接到数据库
      thumbnailUrl: thumbnailUrl || undefined,
      thumbnailOriginalUrl: thumbnailOriginalUrl || undefined,
      size: mainFile.size,
      type: mainFile.mimetype,
      createdAt: Date.now(),
    }
    store.add(record)

    res.json(reply(0, '上传成功', {
      url: mainUrl,
      thumbnailUrl: thumbnailUrl,
      // 兼容前端旧字段
      assets: { path: `/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${cloudMainName}` },
      thumbnailAssets: thumbnailOriginalUrl ? { path: '...' } : undefined,
      // 传回完整的新字段
      urlOriginal: mainUrlOriginal,
      thumbnailOriginalUrl: thumbnailOriginalUrl
    }))

  } catch (err: any) {
    console.error(err)
    res.status(500).json(reply(1, err.message, null))
  }
})

export default app
