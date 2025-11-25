/**
 * CNB Generic Packages (制品库) 工具类
 * 文档参考: https://docs.cnb.cool/zh/artifacts/generic_packages.html
 */

// 定义包名和版本，类似于 S3 的 Bucket 概念
const PACKAGE_NAME = 'imgbed-assets'
const PACKAGE_VERSION = 'v1'

/**
 * 上传文件到 CNB 通用制品库
 * @param {object} param0
 * @param {Buffer} param0.fileBuffer - 文件内容
 * @param {string} param0.fileName - 文件名 (建议使用 UUID.ext 格式以避免冲突)
 */
async function uploadToCnb({ fileBuffer, fileName }) {
  const slug = process.env.SLUG_IMG // 格式如: user/repo
  // 构造制品库上传 API URL
  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${fileName}`

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.TOKEN_IMG}`,
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`CNB Upload Failed: ${resp.status} - ${errText}`)
  }

  // 制品库返回的结构不同，我们构造一个标准返回
  return {
    // 这里的 path 只是为了兼容旧逻辑，实际上我们会在 default.ts 里自己拼接
    path: `/${fileName}`, 
    filename: fileName
  }
}

/**
 * 从 CNB 通用制品库物理删除文件
 * @param {string} fileName - 要删除的文件名
 */
async function deleteFromCnb(fileName) {
  const slug = process.env.SLUG_IMG
  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${fileName}`

  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.TOKEN_IMG}`,
    },
  })

  if (!resp.ok && resp.status !== 404) {
    // 404 也可以视为删除成功（文件本来就不在）
    const errText = await resp.text()
    throw new Error(`CNB Delete Failed: ${resp.status} - ${errText}`)
  }

  return true
}

/**
 * 创建代理处理函数 (针对制品库下载链接)
 * @param {string} baseUrl - 制品库的基础读取路径
 * @param {object} requestConfig 
 */
function createProxyHandler(baseUrl, requestConfig) {
  return async (req, res) => {
    try {
      const urlPath = req.params.path
      if (!urlPath || urlPath.includes('..')) {
        return res.status(400).json({ error: 'Invalid image path' })
      }

      // 构造目标 URL
      const targetUrl = new URL(urlPath, baseUrl).toString()

      const fetchOptions = {
        method: 'GET',
        headers: requestConfig?.headers || {},
        // 转发 range 头支持视频拖动或断点续传
        ...(req.headers.range && { headers: { ...requestConfig?.headers, Range: req.headers.range } })
      }

      const response = await fetch(targetUrl, fetchOptions)

      if (response.ok) {
        // 透传 Content-Type 和 Content-Length
        const contentType = response.headers.get('content-type')
        const contentLength = response.headers.get('content-length')
        
        if (contentType) res.setHeader('Content-Type', contentType)
        if (contentLength) res.setHeader('Content-Length', contentLength)
        
        // 设置强缓存，因为制品库文件通常不会变
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

        // 使用流式传输，性能更好
        const reader = response.body.getReader()
        const stream = new ReadableStream({
          start(controller) {
            return pump()
            function pump() {
              return reader.read().then(({ done, value }) => {
                if (done) {
                  controller.close()
                  return
                }
                controller.enqueue(value)
                return pump()
              })
            }
          }
        })
        
        // Node.js 环境下将 Web Stream 转为 Node Stream
        const { Readable } = await import('stream')
        // @ts-ignore
        Readable.fromWeb(stream).pipe(res)
      } else {
        if (response.status === 404) {
           return res.status(404).send('Not Found')
        }
        res.status(response.status).json({ error: `Upstream error: ${response.statusText}` })
      }
    } catch (e) {
      console.error(`❌ [Proxy Error] ${e.message}`)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}

export { uploadToCnb, deleteFromCnb, createProxyHandler, PACKAGE_NAME, PACKAGE_VERSION }
