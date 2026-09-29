/**
 * 本地联调服务器（仅开发用，不参与生产部署）：
 *   - :8788  /api/*           → 真实 node-functions Express 应用（经 vite ssrLoadModule 加载 TS）
 *   - :8788  /image-records   → 边缘函数本地模拟器（真实 functions/image-records 代码 + 文件持久化 KV 模拟）
 *   - :9000  S3 mock          → 带 SigV4 验证的 S3 兼容存储模拟器（验证签名实现 + 本地闭环上传/代理/删除）
 *
 * 用法：node scripts/dev-server.mjs（配合 vite.config 的 /api、/image-records 代理）
 * 环境变量从 .env.local 读取（已 gitignore）：SITE_PASSWORD / SLUG_IMG / TOKEN_IMG / BASE_IMG_URL 等
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'

const UNSIGNED = 'UNSIGNED-PAYLOAD'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

try {
  process.loadEnvFile(path.join(root, '.env.local'))
  console.log('[dev] 已加载 .env.local')
} catch {
  console.log('[dev] 未找到 .env.local，仅使用当前 shell 环境变量')
}

// ---------------------------------------------------------------- KV 模拟（文件持久化）
const kvDir = path.join(root, 'dev-data')
const kvFile = path.join(kvDir, 'kv.json')
fs.mkdirSync(kvDir, { recursive: true })
const kvRaw = fs.existsSync(kvFile) ? fs.readFileSync(kvFile, 'utf8') : '{}'
const kvStore = new Map(Object.entries(JSON.parse(kvRaw || '{}')))
let kvSaveTimer = null
function scheduleKvSave() {
  clearTimeout(kvSaveTimer)
  kvSaveTimer = setTimeout(() => {
    fs.writeFileSync(kvFile, JSON.stringify(Object.fromEntries(kvStore)))
  }, 200)
}
// EdgeOne Pages KV 的本地模拟：get/put/delete/list（键名字典序分页，契约见 functions/image-records/_lib.js）
globalThis.IMG_RECORDS_KV = {
  async get(key, opts = {}) {
    const raw = kvStore.get(key)
    if (raw === undefined || raw === null) return null
    if (opts?.type === 'json') {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    return raw
  },
  async put(key, value) {
    kvStore.set(key, String(value))
    scheduleKvSave()
  },
  async delete(key) {
    kvStore.delete(key)
    scheduleKvSave()
  },
  async list({ prefix = '', cursor = '', limit = 100 } = {}) {
    const keys = [...kvStore.keys()].filter((k) => k.startsWith(prefix)).sort()
    let start = 0
    if (cursor) {
      const at = keys.findIndex((k) => k > cursor)
      if (at >= 0) start = at
    }
    const page = keys.slice(start, start + limit)
    return {
      keys: page.map((key) => ({ key })),
      cursor: page.at(-1) || cursor,
      complete: start + limit >= keys.length,
    }
  },
}
console.log(`[dev] KV 模拟就绪（${kvStore.size} 键，持久化于 dev-data/kv.json）`)

// ---------------------------------------------------------------- 经 vite 加载真实代码（TS 直接可跑）
const vite = await createViteServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  logLevel: 'error',
})

const nodeApp = (await vite.ssrLoadModule('/node-functions/api/[[default]].ts')).default
const edgeOnRequest = (await vite.ssrLoadModule('/functions/image-records/index.js')).onRequest
console.log('[dev] node-functions Express 应用 + 边缘函数已加载')

// ---------------------------------------------------------------- 边缘函数模拟器（Fetch API 适配层）
async function handleEdge(req, res) {
  const url = `http://localhost:8788${req.url}`
  const method = req.method || 'GET'
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(','))
  }
  let body
  if (!['GET', 'HEAD'].includes(method)) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    body = Buffer.concat(chunks)
  }
  const request = new Request(url, {
    method,
    headers,
    body: body && body.length > 0 ? body : undefined,
  })
  const response = await edgeOnRequest({ request, env: process.env })
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(Buffer.from(await response.arrayBuffer()))
}

// ---------------------------------------------------------------- S3 mock（带 SigV4 验证）
const S3_ACCESS_KEY = process.env.S3_MOCK_ACCESS_KEY || 'imgbed-local'
const S3_SECRET_KEY = process.env.S3_MOCK_SECRET_KEY || 'imgbed-local-secret'
const s3Buckets = new Set([process.env.S3_MOCK_BUCKET || 'imgbed'])
const s3Objects = new Map() // `${bucket}/${key}` → { body: Buffer, contentType: string }

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'
function s3Error(code, message, status) {
  return { status, body: `${XML_HEADER}<Error><Code>${code}</Code><Message>${message}</Message></Error>` }
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** 复核 SigV4：用收到的原始请求按规范重建签名（独立于签名实现，可捕捉规范化错误） */
function verifySigV4(req, rawBody) {
  const auth = req.headers.authorization || ''
  const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^/]+)\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/)
  if (!m) return { ok: false, code: 'AccessDenied', message: '缺少或无法解析 Authorization 头' }
  const [, accessKey, dateStamp, region, signedHeadersRaw, signature] = m
  if (accessKey !== S3_ACCESS_KEY) return { ok: false, code: 'InvalidAccessKeyId', message: 'AccessKeyId 不匹配' }

  const signedHeaders = signedHeadersRaw.split(';')
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${String(req.headers[name] ?? '').trim()}\n`)
    .join('')
  const [rawPath, rawQuery = ''] = req.url.split('?')
  const canonicalQuery = rawQuery
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=')
      return at >= 0 ? [pair.slice(0, at), pair.slice(at + 1)] : [pair, '']
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const payloadHeader = req.headers['x-amz-content-sha256'] || UNSIGNED
  const payloadHash = payloadHeader === UNSIGNED ? UNSIGNED : sha256Hex(rawBody)

  const canonicalRequest = [
    req.method,
    rawPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n')
  const amzDate = req.headers['x-amz-date']
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStamp}/${region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${S3_SECRET_KEY}`, dateStamp), region), 's3'), 'aws4_request')
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  if (expected !== signature) {
    return { ok: false, code: 'SignatureDoesNotMatch', message: '签名不匹配（规范化请求与预期不一致）' }
  }
  return { ok: true }
}

async function handleS3(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks)
  const check = verifySigV4(req, rawBody)
  if (!check.ok) {
    const e = s3Error(check.code, check.message, 403)
    res.writeHead(e.status, { 'content-type': 'application/xml' })
    return res.end(e.body)
  }

  const [rawPath, rawQuery = ''] = req.url.split('?')
  const decodedPath = decodeURIComponent(rawPath)
  const segs = decodedPath.replace(/^\/+/, '').split('/')
  const bucket = segs.shift() || ''
  const key = segs.join('/')
  const query = new URLSearchParams(rawQuery)

  if (!s3Buckets.has(bucket)) {
    const e = s3Error('NoSuchBucket', '桶不存在', 404)
    res.writeHead(e.status, { 'content-type': 'application/xml' })
    return res.end(e.body)
  }

  // HeadBucket
  if (req.method === 'HEAD' && !key) {
    res.writeHead(200, { 'x-amz-bucket-region': 'us-east-1' })
    return res.end()
  }

  // PutObject
  if (req.method === 'PUT' && key) {
    s3Objects.set(`${bucket}/${key}`, {
      body: rawBody,
      contentType: req.headers['content-type'] || 'application/octet-stream',
    })
    res.writeHead(200, { etag: `"${crypto.createHash('md5').update(rawBody).digest('hex')}"` })
    return res.end()
  }

  // GetObject
  if (req.method === 'GET' && key && !query.has('list-type')) {
    const obj = s3Objects.get(`${bucket}/${key}`)
    if (!obj) {
      const e = s3Error('NoSuchKey', '对象不存在', 404)
      res.writeHead(e.status, { 'content-type': 'application/xml' })
      return res.end(e.body)
    }
    res.writeHead(200, { 'content-type': obj.contentType, 'content-length': String(obj.body.length) })
    return res.end(obj.body)
  }

  // ListObjectsV2
  if (req.method === 'GET' && query.has('list-type')) {
    const prefix = query.get('prefix') || ''
    const token = query.get('continuation-token')
    const all = [...s3Objects.keys()]
      .filter((k) => k.startsWith(`${bucket}/`))
      .map((k) => k.slice(bucket.length + 1))
      .filter((k) => !prefix || k.startsWith(prefix))
      .sort()
    let startAt = 0
    if (token) {
      const at = all.findIndex((k) => k > Buffer.from(token, 'base64url').toString())
      if (at >= 0) startAt = at
    }
    const page = all.slice(startAt, startAt + 1000)
    const nextAt = startAt + 1000
    const truncated = nextAt < all.length
    const body =
      XML_HEADER +
      `<ListBucketResult><Name>${bucket}</Name><Prefix></Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
      page
        .map(
          (k) =>
            `<Contents><Key>${k.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</Key><Size>${s3Objects.get(`${bucket}/${k}`).body.length}</Size></Contents>`,
        )
        .join('') +
      (truncated
        ? `<NextContinuationToken>${Buffer.from(page.at(-1) || '').toString('base64url')}</NextContinuationToken>`
        : '') +
      '</ListBucketResult>'
    res.writeHead(200, { 'content-type': 'application/xml' })
    return res.end(body)
  }

  // DeleteObjects（批量）
  if (req.method === 'POST' && query.has('delete')) {
    const keys = [...rawBody.toString('utf8').matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) =>
      m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    )
    for (const k of keys) s3Objects.delete(`${bucket}/${k}`)
    const body =
      XML_HEADER +
      '<DeleteResult>' +
      keys.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join('') +
      '</DeleteResult>'
    res.writeHead(200, { 'content-type': 'application/xml' })
    return res.end(body)
  }

  // DeleteObject（单键）
  if (req.method === 'DELETE' && key) {
    s3Objects.delete(`${bucket}/${key}`)
    res.writeHead(204)
    return res.end()
  }

  const e = s3Error('MethodNotAllowed', '不支持的操作', 405)
  res.writeHead(e.status, { 'content-type': 'application/xml' })
  res.end(e.body)
}

// ---------------------------------------------------------------- 服务器装配
const apiServer = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api/') || url === '/api') {
    // 生产环境 EdgeOne 以 dest /api/$1 挂载（应用内路径不含 /api 前缀），模拟器需同样剥前缀
    req.url = url.replace(/^\/api/, '') || '/'
    return nodeApp(req, res)
  }
  if (url.startsWith('/image-records')) {
    return handleEdge(req, res).catch((e) => {
      console.error('[dev] 边缘函数异常:', e)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 1, msg: `模拟器异常: ${e.message}`, data: null }))
    })
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ code: 1, msg: 'dev server: 未匹配路径（仅 /api 与 /image-records）', data: null }))
})

apiServer.listen(8788, '127.0.0.1', () => {
  console.log('[dev] API + 边缘模拟器: http://localhost:8788（vite 代理 /api 与 /image-records 到此）')
})

if (process.env.S3_MOCK !== '0') {
  const s3Server = http.createServer((req, res) => {
    handleS3(req, res).catch((e) => {
      console.error('[dev] S3 mock 异常:', e)
      res.writeHead(500, { 'content-type': 'application/xml' })
      res.end(`${XML_HEADER}<Error><Code>InternalError</Code><Message>${e.message}</Message></Error>`)
    })
  })
  s3Server.listen(9000, '127.0.0.1', () => {
    console.log('[dev] S3 mock: http://127.0.0.1:9000（桶 imgbed，SigV4 验证开启）')
  })
}
