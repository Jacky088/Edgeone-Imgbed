import crypto from 'node:crypto'

// ===== 零依赖 S3 SigV4 客户端（PUT / GET / DELETE / ListObjectsV2 / HeadBucket）=====
// 仅实现图床需要的最小操作子集；路径寻址默认 path-style（R2 / OSS / COS / MinIO 通吃）。
// 签名规则遵循 AWS SigV4：payload 统一 UNSIGNED-PAYLOAD（DeleteObjects 除外，需真实哈希 + Content-MD5）。

export interface S3Config {
  id: string
  endpoint: string
  bucket: string
  region: string
  pathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
}

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** AWS SigV4 URI 编码：仅 A-Za-z0-9 - . _ ~ 不编码（encodeURIComponent 会放过 ! ' ( ) *，不能用） */
export function sigUriEncode(str: string, encodeSlash = true): string {
  let out = ''
  for (const byte of Buffer.from(str, 'utf8')) {
    const ch = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch
    else if (ch === '/' && !encodeSlash) out += ch
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}

/** endpoint 归一化：去协议与尾斜杠；返回 { scheme, host } */
function parseEndpoint(endpoint: string): { scheme: string; host: string } {
  const m = endpoint.match(/^(https?):\/\/([^/]+)\/?$/)
  if (!m) throw new Error(`S3 endpoint 格式无效：${endpoint}`)
  return { scheme: m[1], host: m[2].toLowerCase() }
}

interface SignedRequest {
  method: string
  url: string
  headers: Record<string, string>
}

/**
 * 构造 SigV4 签名的请求参数（path-style 或 virtual-host 均支持）。
 * extraHeaders 中出现 host / x-amz-* 会覆盖默认值；content-type / content-md5 会被纳入签名。
 */
export function signS3Request(
  cfg: S3Config,
  method: string,
  key: string,
  query: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
  payloadHash: string = UNSIGNED_PAYLOAD,
  now = new Date(),
): SignedRequest {
  const { scheme, host } = parseEndpoint(cfg.endpoint)
  const bucketHost = cfg.pathStyle ? host : `${cfg.bucket}.${host}`
  const canonicalPath = cfg.pathStyle ? `/${cfg.bucket}/${key}` : `/${key}`

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  const headers: Record<string, string> = {
    host: bucketHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  }
  const signedHeaders = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('')

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${sigUriEncode(k)}=${sigUriEncode(query[k] ?? '')}`)
    .join('&')

  const canonicalRequest = [
    method.toUpperCase(),
    sigUriEncode(canonicalPath, false),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`

  // URL 与规范化路径必须逐字节一致（SigV4 对路径签名），统一用 encodeSlash=false 的编码
  const canonicalUri = sigUriEncode(canonicalPath, false)
  const url = `${scheme}://${bucketHost}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  return { method: method.toUpperCase(), url, headers: { ...headers, Authorization: authorization } }
}

// ---------------------------------------------------------------- XML 最小解析

function xmlDecode(s: string): string {
  return s
    // 实体码点钳制在 Unicode 范围内：恶意/畸形 XML 的超界实体不再抛 RangeError
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function firstTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? xmlDecode(m[1]) : null
}

// ---------------------------------------------------------------- 基础操作

const S3_TIMEOUT_MS = 30_000

export interface S3Error extends Error {
  status?: number
  code?: string
}

/** 抛出带 HTTP 状态码与 S3 错误码的异常（错误信息不包含签名等敏感头） */
async function s3Fetch(cfg: S3Config, signed: SignedRequest, body?: Buffer): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
    })
  } catch (e: unknown) {
    const err = new Error('无法连接到 S3 端点（网络错误或超时）') as S3Error
    err.code = 'NetworkError'
    throw err
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const code = firstTag(text, 'Code') || ''
    // HEAD 响应无 body（HTTP 规范），按状态码给出可行动的提示
    const hints: Record<number, string> = {
      400: '请求格式被拒绝',
      401: '访问密钥无效',
      403: '签名不匹配或无访问权限',
      404: '桶不存在（检查桶名与端点是否配套）',
    }
    const hint = !code && hints[resp.status] ? `：${hints[resp.status]}` : ''
    const err = new Error(`S3 返回 HTTP ${resp.status}${code ? `（${code}）` : hint}`) as S3Error
    err.status = resp.status
    err.code = code || `HTTP${resp.status}`
    throw err
  }
  return resp
}

/** 上传对象（内存 Buffer，图床单文件 ≤25MB，无需分片） */
export async function s3PutObject(cfg: S3Config, key: string, body: Buffer, contentType: string): Promise<void> {
  const signed = signS3Request(cfg, 'PUT', key, {}, { 'Content-Type': contentType })
  await s3Fetch(cfg, signed, body)
}

/** 拉取对象响应（调用方负责流式消费与释放） */
export async function s3GetObject(cfg: S3Config, key: string): Promise<Response> {
  const signed = signS3Request(cfg, 'GET', key)
  return s3Fetch(cfg, signed)
}

/** 单键删除（404 视为成功） */
export async function s3DeleteObject(cfg: S3Config, key: string): Promise<void> {
  const signed = signS3Request(cfg, 'DELETE', key)
  await s3Fetch(cfg, signed).catch((e: S3Error) => {
    if (e.status !== 404) throw e
  })
}

function toXmlSafe(key: string): string {
  return key.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/** 批量删除（单次 ≤1000，调用方分批；返回逐键结果） */
export async function s3DeleteObjects(cfg: S3Config, keys: string[]): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = []
  const failed: string[] = []
  if (keys.length === 0) return { ok, failed }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Delete><Quiet>true</Quiet>' +
    keys.map((k) => `<Object><Key>${toXmlSafe(k)}</Key></Object>`).join('') +
    '</Delete>'
  const body = Buffer.from(xml, 'utf8')
  const md5 = crypto.createHash('md5').update(body).digest('base64')
  // 注意：signS3Request 内部已按 pathStyle 追加桶前缀，这里传空 key（桶级操作）
  const signed = signS3Request(cfg, 'POST', '', { delete: '' }, { 'Content-MD5': md5 }, sha256Hex(body))
  try {
    const resp = await s3Fetch(cfg, signed, body)
    const text = await resp.text()
    // Quiet 模式只返回 <Error> 块；逐键对照失败清单
    const failedSet = new Set<string>()
    for (const m of text.matchAll(/<Error><Key>([\s\S]*?)<\/Key>/g)) failedSet.add(xmlDecode(m[1]))
    for (const k of keys) (failedSet.has(k) ? failed : ok).push(k)
  } catch {
    return { ok, failed: [...keys] }
  }
  return { ok, failed }
}

export interface S3ListResult {
  items: Array<{ key: string; size: number }>
  truncated: boolean
}

/** 分页拉取桶内全部对象（maxPages 兜底防止超大桶拖垮实例） */
export async function s3ListAll(cfg: S3Config, maxPages = 100): Promise<S3ListResult> {
  const items: S3ListResult['items'] = []
  let token: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' }
    if (token) query['continuation-token'] = token
    // 桶级操作：key 传空（signS3Request 内部按 pathStyle 追加桶前缀）
    const signed = signS3Request(cfg, 'GET', '', query)
    const resp = await s3Fetch(cfg, signed)
    const xml = await resp.text()
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = firstTag(block[1], 'Key')
      if (key) items.push({ key, size: Number(firstTag(block[1], 'Size')) || 0 })
    }
    if ((firstTag(xml, 'IsTruncated') || 'false') !== 'true') {
      return { items, truncated: false }
    }
    token = firstTag(xml, 'NextContinuationToken') || undefined
    if (!token) return { items, truncated: true }
  }
  return { items, truncated: true }
}

/** 连接探活：HeadBucket 验证桶存在与凭证有效性 */
export async function s3HeadBucket(cfg: S3Config): Promise<void> {
  // 桶级操作：key 传空（signS3Request 内部按 pathStyle 追加桶前缀）
  const signed = signS3Request(cfg, 'HEAD', '')
  await s3Fetch(cfg, signed)
}

// ---------------------------------------------------------------- 连接检测闭环

export interface ProbeStep {
  step: 'head' | 'put' | 'get' | 'delete'
  ok: boolean
  detail: string
}

/**
 * 桶连接四步检测：列出（凭证+存在性）→ 写入 → 读回 → 清理。
 * 任一步失败立即返回（半途而废的探针键由下次检测清理，键名固定前缀便于识别）。
 */
export async function s3ProbeBucket(cfg: S3Config): Promise<{ ok: boolean; steps: ProbeStep[]; ms: number }> {
  const steps: ProbeStep[] = []
  const started = Date.now()
  const probeKey = `imgbed-probe-${Date.now()}.txt`
  const probeBody = Buffer.from('imgbed-probe', 'utf8')

  const fail = (step: ProbeStep['step'], e: S3Error): { ok: boolean; steps: ProbeStep[]; ms: number } => {
    steps.push({ step, ok: false, detail: e.message })
    return { ok: false, steps, ms: Date.now() - started }
  }

  try {
    await s3HeadBucket(cfg)
    steps.push({ step: 'head', ok: true, detail: '桶可访问，凭证有效' })
  } catch (e) {
    return fail('head', e as S3Error)
  }

  try {
    await s3PutObject(cfg, probeKey, probeBody, 'text/plain')
    steps.push({ step: 'put', ok: true, detail: '写入成功' })
  } catch (e) {
    return fail('put', e as S3Error)
  }

  try {
    const resp = await s3GetObject(cfg, probeKey)
    const text = await resp.text()
    if (text !== probeBody.toString()) throw new Error('读回内容与写入不一致')
    steps.push({ step: 'get', ok: true, detail: '读取一致' })
  } catch (e) {
    return fail('get', e as S3Error)
  }

  try {
    await s3DeleteObject(cfg, probeKey)
    steps.push({ step: 'delete', ok: true, detail: '删除成功' })
  } catch (e) {
    return fail('delete', e as S3Error)
  }

  return { ok: true, steps, ms: Date.now() - started }
}

/** 探针键前缀（孤儿列表中可识别；usage 汇总时排除） */
export const S3_PROBE_PREFIX = 'imgbed-probe-'

export { UNSIGNED_PAYLOAD, EMPTY_SHA256 }
