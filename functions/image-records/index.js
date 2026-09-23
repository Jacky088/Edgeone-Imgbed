const PREFIX = 'image_'
// 软删除记录保留 30 天，过期由读取时惰性清理
const SOFT_DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1000

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

// 惰性清理：软删除超过保留期的记录物理移除
async function purgeExpired(records) {
  const now = Date.now()
  const expired = records.filter(
    (r) => r.deletedAt && now - r.deletedAt > SOFT_DELETE_TTL_MS,
  )
  if (expired.length === 0) return
  await Promise.all(
    expired.map((r) => IMG_RECORDS_KV.delete(`${PREFIX}${String(r.id).replace(/[^a-zA-Z0-9_]/g, '')}`)),
  )
}

export async function onRequest({ request, env }) {
  try {
    if (!(await isAuthorized(request, env))) {
      return json(401, '未授权访问', null, 401)
    }

    const url = new URL(request.url)
    const ip = getClientIp(request)

    // 写操作更严格：?write=1 富余保护
    if (request.method !== 'GET') {
      if (isRateLimited(`write:${ip}`, 60)) {
        return json(429, '请求过于频繁，请稍后再试', null, 429)
      }
    } else if (isRateLimited(`read:${ip}`, 120)) {
      return json(429, '请求过于频繁，请稍后再试', null, 429)
    }

    // 单次全表扫描 + 可选统计：GET（?stats=1 顺带返回统计，避免列表/统计两次扫描）
    async function snapshot() {
      const records = await listRecords()
      await purgeExpired(records)
      return records
    }

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

    // 统计：总数 / 总大小 / 类型分布（含软删除中的记录）
    if (request.method === 'GET' && url.pathname.endsWith('/stats')) {
      const records = await snapshot()
      return json(0, '获取成功', buildStats(records))
    }

    if (request.method === 'GET') {
      const records = await snapshot()
      // 默认只返回未删除记录；?trash=1 返回回收站
      const showTrash = url.searchParams.get('trash') === '1'
      const filtered = showTrash ? records.filter((r) => r.deletedAt) : records.filter((r) => !r.deletedAt)
      if (url.searchParams.get('stats') === '1') {
        return json(0, '获取成功', { records: filtered, stats: buildStats(records) })
      }
      return json(0, '获取成功', filtered)
    }

    if (request.method === 'POST') {
      const record = await request.json()
      if (!record?.id || !record?.url || !record?.createdAt) {
        return json(1, '记录缺少必要字段', null, 400)
      }

      const safeId = String(record.id).replace(/[^a-zA-Z0-9_]/g, '')
      if (!safeId) return json(1, '无效的记录 ID', null, 400)

      await IMG_RECORDS_KV.put(
        `${PREFIX}${safeId}`,
        JSON.stringify({
          id: record.id,
          name: String(record.name || ''),
          url: String(record.url),
          thumbnailUrl: record.thumbnailUrl ? String(record.thumbnailUrl) : undefined,
          size: Number(record.size) || 0,
          type: String(record.type || ''),
          createdAt: Number(record.createdAt),
        }),
      )
      return json(0, '保存成功', null)
    }

    // PUT：恢复回收站记录（清除 deletedAt 标记）
    if (request.method === 'PUT') {
      const ids = url.searchParams.getAll('id')
      if (ids.length === 0) return json(1, 'ID不能为空', null, 400)
      // 批量恢复：?id=a&id=b（上限 100），单条走同样路径
      const targets = ids.slice(0, 100)
      let ok = 0
      for (const id of targets) {
        const safeId = id.replace(/[^a-zA-Z0-9_]/g, '')
        if (!safeId) continue
        const record = await IMG_RECORDS_KV.get(`${PREFIX}${safeId}`, { type: 'json' })
        if (!record) continue
        delete record.deletedAt
        await IMG_RECORDS_KV.put(`${PREFIX}${safeId}`, JSON.stringify(record))
        ok++
      }
      if (targets.length === 1) {
        return ok === 1 ? json(0, '已恢复', null) : json(1, '记录不存在', null, 404)
      }
      return json(0, `已恢复 ${ok} 条记录`, { ok, fail: targets.length - ok })
    }

    if (request.method === 'DELETE') {
      const ids = url.searchParams.getAll('id')
      if (ids.length === 0) return json(1, 'ID不能为空', null, 400)
      const purge = url.searchParams.get('purge') === '1'
      // 批量删除：?id=a&id=b（上限 100）；默认软删除进回收站，30 天后惰性清理；?purge=1 彻底删除
      const targets = ids.slice(0, 100)
      const keyOf = (id) => `${PREFIX}${id.replace(/[^a-zA-Z0-9_]/g, '')}`
      if (targets.length === 1) {
        const key = keyOf(targets[0])
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) return json(1, '记录不存在', null, 404)
        if (purge) {
          await IMG_RECORDS_KV.delete(key)
          return json(0, '已彻底删除', null)
        }
        record.deletedAt = Date.now()
        await IMG_RECORDS_KV.put(key, JSON.stringify(record))
        return json(0, '已移入回收站', null)
      }
      let ok = 0
      for (const id of targets) {
        const key = keyOf(id)
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) continue
        if (purge) {
          await IMG_RECORDS_KV.delete(key)
        } else {
          record.deletedAt = Date.now()
          await IMG_RECORDS_KV.put(key, JSON.stringify(record))
        }
        ok++
      }
      return json(0, purge ? `已彻底删除 ${ok} 条记录` : `已删除 ${ok} 条记录`, { ok, fail: targets.length - ok })
    }

    return json(405, '不支持的请求方法', null, 405)
  } catch (error) {
    console.error('KV operation failed:', error)
    return json(1, 'KV 存储操作失败，请检查命名空间绑定', null, 500)
  }
}
