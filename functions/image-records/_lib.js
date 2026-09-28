const PREFIX = 'image_'
// 全量索引 key：保存所有记录的精简元数据（id/name/url/size/type/createdAt/width/height/deletedAt），
// 读列表 = 1 次 KV get，替代旧的逐 key 全表扫描（list + N 次 get）
const INDEX_KEY = 'image_records_index'
// 软删除记录保留 30 天，过期由读取时惰性清理
const SOFT_DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1000

// 索引单值上限（KV 值大小限制约为 1MB~25MB 视平台而定，保守取 900KB 字符）
// 超限时仍可正常写入单条记录（索引降级），读取端回退到全表扫描
const INDEX_SAFE_LIMIT_BYTES = 900 * 1024

function json(code, msg, data, status = 200) {
  return new Response(JSON.stringify({ code, msg, data }), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
}

// 与 node-functions/api/_utils.ts 保持一致的密钥派生规则
function getAuthSecret(env) {
  return env?.AUTH_SECRET || `imgbed-auth:${env?.SITE_PASSWORD || ''}`
}

// base64url 解码为二进制字符串
function b64urlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return atob(padded)
}

// 校验 HMAC-SHA256 签名 token 的签名与有效期（与 Node 侧签发逻辑配套）
async function verifyAuthToken(token, env) {
  try {
    const [payload, sig] = token.split('.')
    if (!payload || !sig) return false

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(getAuthSecret(env)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
    )
    const sigBytes = Uint8Array.from(b64urlDecode(sig), (ch) => ch.charCodeAt(0))

    if (sigBytes.length !== mac.length) return false
    let diff = 0
    for (let i = 0; i < mac.length; i++) diff |= sigBytes[i] ^ mac[i]
    if (diff !== 0) return false

    const data = JSON.parse(b64urlDecode(payload))
    return typeof data.exp === 'number' && data.exp > Date.now()
  } catch {
    return false
  }
}

async function isAuthorized(request, env) {
  if (!env?.SITE_PASSWORD) return true
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  return verifyAuthToken(auth.slice(7), env)
}

// 简单的速率限制（内存版，多实例/边缘运行时下为尽力而为的防护，与 node-functions 侧同策略）
const rateLimitMap = new Map()

function getClientIp(request) {
  const eoIp = request.headers.get('eo-client-ip')
  if (eoIp && eoIp.trim()) return eoIp.trim()
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const ips = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (ips.length > 0) return ips[ips.length - 1]
  }
  return 'unknown'
}

// 命中限流返回 true；调用方按读写分桶计数
function isRateLimited(bucket, maxRequests, windowMs = 60000) {
  const now = Date.now()
  const record = rateLimitMap.get(bucket)
  if (!record || now > record.resetTime) {
    rateLimitMap.set(bucket, { count: 1, resetTime: now + windowMs })
    if (rateLimitMap.size > 500) {
      for (const [key, rec] of rateLimitMap) {
        if (now > rec.resetTime) rateLimitMap.delete(key)
      }
    }
    return false
  }
  if (record.count >= maxRequests) return true
  record.count++
  return false
}

function safeIdOf(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, '')
}

function recordKeyOf(safeId) {
  return `${PREFIX}${safeId}`
}

// ---------------------------------------------------------------- 索引层

// 读取索引；缺失/损坏时返回 null（由调用方决定是否回退扫描并重建）
async function readIndex() {
  try {
    const raw = await IMG_RECORDS_KV.get(INDEX_KEY, { type: 'json' })
    if (Array.isArray(raw)) return raw
    return null
  } catch {
    return null
  }
}

// 回退路径：逐 key 全表扫描并重建索引（仅在索引缺失/超限降级时触发）
async function listRecords() {
  const records = []
  let cursor = ''
  let complete = false

  while (!complete) {
    const page = await IMG_RECORDS_KV.list({ prefix: PREFIX, cursor, limit: 256 })
    const keys = Array.isArray(page?.keys) ? page.keys : []
    const values = await Promise.all(
      keys.map(({ key }) => IMG_RECORDS_KV.get(key, { type: 'json' })),
    )

    records.push(...values.filter(Boolean))
    complete = Boolean(page?.complete) || keys.length === 0
    cursor = page?.cursor || keys.at(-1)?.key || ''
  }

  return records.sort((a, b) => b.createdAt - a.createdAt)
}

// 从全量记录重建索引（仅保留列表页所需字段；undefined 字段会被 JSON 序列化丢弃）
function buildIndex(records) {
  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      thumbnailUrl: r.thumbnailUrl,
      size: r.size,
      type: r.type,
      createdAt: r.createdAt,
      width: r.width,
      height: r.height,
      deletedAt: r.deletedAt,
    }))
}

// 写入索引；超过安全体积时放弃写入（读取端会回退扫描），返回是否成功
async function writeIndex(index) {
  try {
    const payload = JSON.stringify(index)
    if (payload.length > INDEX_SAFE_LIMIT_BYTES) return false
    await IMG_RECORDS_KV.put(INDEX_KEY, payload)
    return true
  } catch {
    return false
  }
}

// 保证拿到最新记录集：优先索引，但索引可能落后于记录本体（如恢复后未同步）。
// 以记录本体的 deletedAt 为准逐条对齐，随后写回
async function snapshot() {
  const index = await readIndex()
  if (index) {
    let changed = false
    const missing = []
    for (let i = 0; i < index.length; i++) {
      const body = await IMG_RECORDS_KV.get(recordKeyOf(safeIdOf(index[i].id)), { type: 'json' })
      if (!body) {
        // 本体已不存在（如被彻底删除）：从索引剔除
        index.splice(i, 1)
        i--
        changed = true
        continue
      }
      if (body.deletedAt !== index[i].deletedAt) {
        index[i] = { ...index[i], deletedAt: body.deletedAt }
        changed = true
      }
      missing.push(body)
    }
    if (changed) await writeIndex(index)
    return index
  }
  const records = await listRecords()
  const rebuilt = buildIndex(records)
  await writeIndex(rebuilt)
  return rebuilt
}

// 惰性清理：软删除超过保留期的记录物理移除（同时清索引与记录本体）
async function purgeExpired(records) {
  const now = Date.now()
  const expired = records.filter(
    (r) => r.deletedAt && now - r.deletedAt > SOFT_DELETE_TTL_MS,
  )
  if (expired.length === 0) return records
  await Promise.all(
    expired.map((r) => IMG_RECORDS_KV.delete(recordKeyOf(safeIdOf(r.id)))),
  )
  const expiredIds = new Set(expired.map((r) => r.id))
  return records.filter((r) => !expiredIds.has(r.id))
}

// ---------------------------------------------------------------- 统计 / 切片

function buildStats(records) {
  const active = records.filter((r) => !r.deletedAt)
  const byType = {}
  let totalSize = 0
  let todayCount = 0
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayStartTs = dayStart.getTime()
  for (const r of active) {
    const ext = (r.type || '').split('/')[1] || 'other'
    byType[ext] = (byType[ext] || 0) + 1
    totalSize += Number(r.size) || 0
    if (Number(r.createdAt) >= dayStartTs) todayCount++
  }
  return {
    count: active.length,
    totalSize,
    trashed: records.length - active.length,
    todayCount,
    byType,
  }
}

// 排序 + 切片：服务端完成排序与分页，响应里只带当前页（total 由过滤结果长度提供）
function sortRecords(records, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1
  const sorted = [...records].sort((a, b) => {
    if (sortKey === 'size') return ((Number(a.size) || 0) - (Number(b.size) || 0)) * dir
    if (sortKey === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN') * dir
    return ((Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)) * dir
  })
  return sorted
}

export {
  INDEX_KEY,
  INDEX_SAFE_LIMIT_BYTES,
  json,
  verifyAuthToken,
  isAuthorized,
  isRateLimited,
  getClientIp,
  safeIdOf,
  recordKeyOf,
  readIndex,
  listRecords,
  buildIndex,
  writeIndex,
  snapshot,
  purgeExpired,
  buildStats,
  sortRecords,
}
