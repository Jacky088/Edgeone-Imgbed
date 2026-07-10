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
  })

  if (!metaResp.ok) {
    throw new Error('Failed to get upload metadata')
  }

  const { assets, upload_url } = await metaResp.json()

  const uploadResp = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  })

  if (!uploadResp.ok) {
    throw new Error('Failed to upload image')
  }

  return { assets, url: assets['path'] }
}

/**
 * 创建代理处理函数
 * @param {string} baseUrl 基础URL
 * @param {object} requestConfig 请求配置
 * @returns 路由处理函数
 */
function createProxyHandler(
  baseUrl: string,
  requestConfig: { headers?: Record<string, string>; timeout?: number },
) {
  return async (req: any, res: any) => {
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

      // 额外验证：只允许常见的图片扩展名
      const allowedExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i
      if (!allowedExtensions.test(urlPath)) {
        console.error('❌ [Proxy] Forbidden file type:', urlPath)
        return res.status(403).json({ error: 'Forbidden file type' })
      }

      const targetUrl = new URL(urlPath, baseUrl).toString()
      console.log(`🔄 [Proxy] ${req.path || req.url} -> ${targetUrl}`)

      const fetchOptions = {
        method: 'GET',
        headers: requestConfig?.headers || {},
        signal: requestConfig?.timeout ? AbortSignal.timeout(requestConfig.timeout) : undefined,
      }

      const response = await fetch(targetUrl, fetchOptions)

      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/png'
        const arrayBuffer = await response.arrayBuffer()

        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.send(Buffer.from(arrayBuffer))
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
}

export { uploadToCnb, createProxyHandler }

