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

// 命中限流返回 true；调用方按读写分桶计数。
// 本地内存为第一层快路径，IMG_RECORDS_KV 为跨实例共享计数层（固定窗口）；
// KV 未绑定或操作失败时自动降级为纯内存（尽力而为）。
// 注入式转义：非 [a-zA-Z0-9] 字符 → _x{十六进制}x，满足 KV 键仅允许数字/字母/下划线
// 的约束，且不同原始输入（如 IPv4 与 IPv6 片段）不碰撞
function sanitizeLimitKey(input) {
  return String(input).replace(/[^a-zA-Z0-9]/g, (ch) => `_x${ch.charCodeAt(0).toString(16)}x`)
}

function kvAvailable() {
  return typeof IMG_RECORDS_KV !== 'undefined' && IMG_RECORDS_KV && typeof IMG_RECORDS_KV.get === 'function'
}

async function isRateLimited(bucket, maxRequests, windowMs = 60000) {
  const now = Date.now()
  const windowId = Math.floor(now / windowMs)
  const memKey = `${windowId}:${bucket}`

  // 内存快路径：本实例已超限直接拒绝（内存计数只会比全局少，超限判定不会误放行）
  const mem = rateLimitMap.get(memKey)
  if (mem && now <= mem.resetTime && mem.count >= maxRequests) return true

  if (!kvAvailable()) {
    bumpMemory(memKey, windowMs, now)
    return false
  }

  const kvKey = `rl${sanitizeLimitKey(bucket)}${windowId}`
  try {
    const raw = await IMG_RECORDS_KV.get(kvKey)
    const count = Number(raw) || 0
    if (count >= maxRequests) {
      bumpMemory(memKey, windowMs, now)
      return true
    }
    await IMG_RECORDS_KV.put(kvKey, String(count + 1))
    bumpMemory(memKey, windowMs, now)
    // 新窗口首次写入时顺手清理上一窗口的 key，避免 KV 中 rl 前缀键无限累积
    if (count === 0) {
      Promise.resolve(IMG_RECORDS_KV.delete(`rl${sanitizeLimitKey(bucket)}${windowId - 1}`)).catch(() => {})
    }
    return false
  } catch {
    // KV 不可用：降级为纯内存限流（尽力而为）
    bumpMemory(memKey, windowMs, now)
    return false
  }
}

function bumpMemory(memKey, windowMs, now) {
  const rec = rateLimitMap.get(memKey)
  if (!rec || now > rec.resetTime) {
    rateLimitMap.set(memKey, { count: 1, resetTime: now + windowMs })
    if (rateLimitMap.size > 500) {
      for (const [key, r] of rateLimitMap) {
        if (now > r.resetTime) rateLimitMap.delete(key)
      }
    }
    return
  }
  rec.count++
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
// 以记录本体的 deletedAt 为准逐条对齐，随后写回。
// force=true 时跳过索引强制全表扫描重建（?rebuild=1 恢复工具，历史被误清时自救）。
// 刚写入的记录容忍读写延迟：60 秒宽限期内本体暂时读不到不剔除（防最终一致性延迟误判为已删除）
const EVICT_GRACE_MS = 60 * 1000

async function snapshot(force = false) {
  const index = force ? null : await readIndex()
  if (index) {
    const now = Date.now()
    let changed = false
    for (let i = 0; i < index.length; i++) {
      const body = await IMG_RECORDS_KV.get(recordKeyOf(safeIdOf(index[i].id)), { type: 'json' })
      if (!body) {
        // 本体暂时读不到：宽限期内视为仍在（读写延迟），超时才判定已删除并从索引剔除
        if (now - (Number(index[i].createdAt) || 0) < EVICT_GRACE_MS) continue
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
    }
    if (changed) await writeIndex(index)
    return index
  }
  const records = await listRecords()
  // 全表扫描为空时不写空索引：KV.list 可能不可用（返回空≠真没数据），
  // 固化空索引会把全部历史记录永久埋掉；后续写入路径会自行追加索引条目
  if (records.length === 0) return []
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
  const byType = {}
  let totalSize = 0
  let trashedSize = 0
  let trashed = 0
  let todayCount = 0
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayStartTs = dayStart.getTime()
  for (const r of records) {
    if (r.deletedAt) {
      // 软删除记录的原图仍占用 CNB 存储（删除不落盘），单独暴露体积便于用户感知
      trashed++
      trashedSize += Number(r.size) || 0
      continue
    }
    const ext = (r.type || '').split('/')[1] || 'other'
    byType[ext] = (byType[ext] || 0) + 1
    totalSize += Number(r.size) || 0
    if (Number(r.createdAt) >= dayStartTs) todayCount++
  }
  return {
    count: records.length - trashed,
    totalSize,
    trashed,
    trashedSize,
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

// ===== CNB 平台资产清单（孤儿文件扫描）=====
// 官方接口 GET /{slug}/-/list-assets（分页，令牌需 repo-manage:r）。
// 孤儿 = 平台清单中存在、但没有任何上传记录（含回收站）引用的 slug_img 资源。
// 本模块只做读取对比；删除复用 node-functions 的 POST /api/file/delete-cnb
// （DELETE /-/imgs/{imgPath}，令牌需 repo-manage:rw）。
const CNB_LIST_PAGE_SIZE = 100
const CNB_LIST_MAX_PAGES = 30 // 单次扫描上限 3000 个资产，超出标记 truncated
const CNB_LIST_TIMEOUT_MS = 10000

// 与 node-functions/api/_utils.ts 的 extractCnbImgPath 同规则：兼容 /api/img/ 与原生 -/imgs/、-/files/ 链接
function cnbImgPathOf(recordUrl) {
  const raw = String(recordUrl || '')
  const markers = ['/api/img/', '-/imgs/', '-/files/']
  for (const marker of markers) {
    const idx = raw.indexOf(marker)
    if (idx >= 0) {
      const p = raw.slice(idx + marker.length).split(/[?#]/)[0]
      if (p) return p
    }
  }
  return null
}

// 平台资产的 path → imgPath（可能带 -/imgs/ 前缀，也可能已是裸路径）
function normalizeAssetPath(assetPath) {
  const raw = String(assetPath || '')
  const idx = raw.indexOf('-/imgs/')
  if (idx >= 0) {
    const p = raw.slice(idx + '-/imgs/'.length).split(/[?#]/)[0]
    return p || null
  }
  const p = raw.split(/[?#]/)[0]
  return p || null
}

// 分页拉取仓库全部平台资产：{ ok, assets?, others?, truncated?, reason? }
// 仅收集 slug_img（我们经 upload/imgs 上传的类型），其他类型计数后跳过
async function listCnbImgAssets(env) {
  const slug = env?.SLUG_IMG
  const token = env?.TOKEN_IMG
  if (!slug || !token) return { ok: false, reason: 'missing-env' }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.cnb.api+json' }
  const assets = []
  let others = 0
  try {
    for (let page = 1; page <= CNB_LIST_MAX_PAGES; page++) {
      const resp = await Promise.race([
        fetch(`https://api.cnb.cool/${slug}/-/list-assets?page=${page}&page_size=${CNB_LIST_PAGE_SIZE}`, { headers }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CNB_LIST_TIMEOUT_MS)),
      ])
      if (resp.status === 403) return { ok: false, reason: 'forbidden' }
      if (!resp.ok) return { ok: false, reason: 'upstream' }
      // CNB 空仓库返回字面量 null 而非 []，需兜底
      const list = (await resp.json()) || []
      if (!Array.isArray(list)) return { ok: false, reason: 'upstream' }
      for (const item of list) {
        if (item?.record_type === 'slug_img') {
          const path = normalizeAssetPath(item.path)
          if (path) assets.push({ path, size: Number(item.size_in_byte) || 0, createdAt: String(item.created_at || '') })
        } else {
          others++
        }
      }
      if (list.length < CNB_LIST_PAGE_SIZE) return { ok: true, assets, others, truncated: false }
    }
  } catch {
    return { ok: false, reason: 'network' }
  }
  return { ok: true, assets, others, truncated: true }
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
  cnbImgPathOf,
  normalizeAssetPath,
  listCnbImgAssets,
}
