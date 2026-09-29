import crypto from 'node:crypto'
import { deleteFromCnb, getInternalAuthSecret } from './_utils'
import { s3DeleteObjects, s3GetObject, type S3Config } from './_s3'

// ===== 多存储注册表：桶配置（KV，经边缘函数内部端点读取）+ 路由标记解析 + S3 代理/删除 =====
//
// 路由标记（公开 URL 中的存储标识，全部经 /api/img 同源代理）：
//   CNB（默认）        →  {BASE}/api/img/{path}          （存量链接，不带前缀，零影响）
//   S3 桶 id 为 {id}   →  {BASE}/api/img/s3-{id}/{key}
// 解析规则：`s3-{id}/` 后必须存在 `/` 才视为标记；CNB 文件名经 sanitizeFilename 过滤不含 `/`，
// 因此 `s3-xxx/yyy` 与 CNB 原名文件不存在歧义。
export const BUCKET_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/

export interface StorageBucket {
  id: string
  label: string
  endpoint: string
  bucket: string
  region: string
  pathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
  /** 空间配额（字节），null/undefined = 不限 */
  quotaBytes?: number | null
  createdAt: number
  lastTestAt?: number
  lastTestOk?: boolean
}

export interface StorageConfigDoc {
  /** 全局默认上传后端：'cnb' 或桶 id（全局生效：新上传进所选后端，旧图原地不动） */
  active: string
  buckets: StorageBucket[]
}

/** 单桶累计上传统计（记录派生，含回收站占用） */
export interface BucketStats {
  count: number
  size: number
}

export type StorageStatsMap = Record<string, BucketStats>

// ---------------------------------------------------------------- 路由标记解析

export type ParsedStoragePath = { storage: 'cnb'; path: string } | { storage: 's3'; id: string; key: string }

/** 解析 /api/img/ 下的路径为存储目标；非法标记（id 不合规范）按 CNB 处理走原有 404 逻辑 */
export function parseStoragePath(rawPath: string): ParsedStoragePath {
  const p = rawPath.replace(/^\/+/, '')
  const m = p.match(/^s3-([a-z0-9][a-z0-9-]{0,30})\/(.+)$/)
  if (m) return { storage: 's3', id: m[1], key: m[2] }
  return { storage: 'cnb', path: p }
}

/** 从记录/直链 URL 中提取带标记的存储路径（兼容 /api/img/ 代理链接；CNB 原生链接回退 CNB） */
export function extractStoragePath(recordUrl: string): ParsedStoragePath | null {
  const idx = recordUrl.indexOf('/api/img/')
  if (idx >= 0) {
    const p = recordUrl.slice(idx + '/api/img/'.length).split(/[?#]/)[0]
    if (!p) return null
    // 畸形百分号编码（%zz）直接按无法解析处理，不让 URIError 冒泡成 500
    try {
      return parseStoragePath(decodeURIComponent(p))
    } catch {
      return null
    }
  }
  // 兼容 CNB 原生 -/imgs/、-/files/ 链接（旧记录）
  for (const marker of ['-/imgs/', '-/files/']) {
    const at = recordUrl.indexOf(marker)
    if (at >= 0) {
      const p = recordUrl.slice(at + marker.length).split(/[?#]/)[0]
      if (p) return { storage: 'cnb', path: p }
    }
  }
  return null
}

// ---------------------------------------------------------------- 内部端点鉴权
// node ↔ edge 双向互信：HMAC(AUTH 派生密钥, 固定常量)，两侧派生规则一致（与 token 密钥同源）

export const INTERNAL_AUTH_CONST = 'imgbed-internal-auth:v1'

/** 内部令牌：仅 AUTH_SECRET 可派生；未设置返回空串（verify 端恒拒绝） */
export function internalAuthToken(): string {
  const secret = getInternalAuthSecret()
  if (!secret) return ''
  return crypto.createHmac('sha256', secret).update(INTERNAL_AUTH_CONST).digest('base64url')
}

export function verifyInternalAuth(header: string | undefined): boolean {
  const expected = internalAuthToken()
  // 未配置 AUTH_SECRET：内部端点整体失效（多存储功能关闭），而非退化为公开可计算
  if (!expected || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---------------------------------------------------------------- 桶配置读取（内部端点 + 进程内缓存）

// 缓存仅用于保护上传热路径（批量上传每文件一次解析），5 秒内可能读到刚切换的旧默认——
// 换取批量上传不为每个文件多打一次内部端点；UI 路径（/config 等）一律 force 拉最新
const CONFIG_CACHE_TTL_MS = 5_000
let configCache: { at: number; doc: StorageConfigDoc; stats: StorageStatsMap } | null = null

/**
 * 读取存储配置 + 分桶统计（边缘函数 KV，单次内部请求同取）。
 * 缓存 5 秒；拉取失败时回退最近一次成功副本（桶配置变更低频，宁可旧不可瘫）。
 * BASE_IMG_URL 缺失或从未成功拉取时返回 null（S3 功能整体不可用，CNB 不受影响）。
 */
export async function getStorageConfig(force = false): Promise<StorageConfigDoc | null> {
  return (await fetchStorageContext(force))?.doc ?? null
}

/** 分桶累计统计（与配置同缓存）；无数据时返回空映射 */
export async function getStorageStats(force = false): Promise<StorageStatsMap> {
  return (await fetchStorageContext(force))?.stats ?? {}
}

async function fetchStorageContext(force = false): Promise<{ doc: StorageConfigDoc; stats: StorageStatsMap } | null> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache
  }
  const base = (process.env.BASE_IMG_URL || '').replace(/\/$/, '')
  if (!base) return configCache
  try {
    const resp = await fetch(`${base}/image-records?storage-internal=1`, {
      headers: { 'x-internal-auth': internalAuthToken() },
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const { code, data } = (await resp.json()) as {
      code: number
      data: (StorageConfigDoc & { stats?: StorageStatsMap }) | null
    }
    if (code !== 0 || !data) throw new Error('bad payload')
    const doc: StorageConfigDoc = {
      active: data.active || 'cnb',
      buckets: Array.isArray(data.buckets) ? data.buckets : [],
    }
    const ctx = { doc, stats: data.stats && typeof data.stats === 'object' ? data.stats : {} }
    configCache = { at: Date.now(), ...ctx }
    return ctx
  } catch {
    // 拉取失败：有旧副本用旧的，没有则 S3 不可用
    return configCache
  }
}

export function findBucket(doc: StorageConfigDoc | null, id: string): StorageBucket | null {
  return doc?.buckets.find((b) => b.id === id) ?? null
}

export type ActiveBackend = { kind: 'cnb' } | { kind: 's3'; cfg: StorageBucket }

/**
 * 解析上传目标后端：
 * - requested 为空 → 全局默认（设置页切换，KV 持久化）
 * - requested = 'cnb' 或桶 id（兼容 s3-{id} 标记）→ 顶栏下拉的本机选择，服务端严格校验存在性
 * 配置缺失/桶被删时显式报错（不静默回退，避免图片落错地方）
 */
export async function getActiveBackend(requested?: string): Promise<ActiveBackend> {
  const doc = await getStorageConfig()
  if (requested) {
    const id = String(requested).trim()
    if (id === 'cnb') return { kind: 'cnb' }
    const bare = id.startsWith('s3-') ? id.slice(3) : id
    const cfg = BUCKET_ID_RE.test(bare) ? findBucket(doc, bare) : null
    if (!cfg) {
      throw new Error(`请求的上传目标 s3-${bare} 不存在或已被删除，请重新选择存储桶`)
    }
    return { kind: 's3', cfg }
  }
  const active = doc?.active || 'cnb'
  if (active === 'cnb') return { kind: 'cnb' }
  const cfg = findBucket(doc, active)
  if (!cfg) {
    throw new Error(`默认存储 s3-${active} 配置不存在（可能已被删除），请到设置页重新选择默认存储`)
  }
  return { kind: 's3', cfg }
}

export function toS3Config(b: StorageBucket): S3Config {
  return {
    id: b.id,
    endpoint: b.endpoint,
    bucket: b.bucket,
    region: b.region || 'us-east-1',
    pathStyle: b.pathStyle !== false,
    accessKeyId: b.accessKeyId,
    secretAccessKey: b.secretAccessKey,
  }
}

// ---------------------------------------------------------------- S3 图片代理（流式）

const ALLOWED_PROXY_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)$/i

const S3_PROXY_MAX_BYTES = 20 * 1024 * 1024

/** S3 对象流式代理：SigV4 GET 后原样转发（校验与缓存策略与 CNB 代理一致） */
export async function proxyS3Request(cfg: StorageBucket, key: string, res: any): Promise<void> {
  if (!key || key.includes('..') || key.includes('\\') || !ALLOWED_PROXY_EXTENSIONS.test(key)) {
    return res.status(403).json({ error: 'Forbidden image path' })
  }
  try {
    const resp = await s3GetObject(toS3Config(cfg), key)
    const contentType = resp.headers.get('content-type') || 'application/octet-stream'
    if (!contentType.startsWith('image/')) {
      await resp.arrayBuffer().catch(() => {})
      return res.status(502).json({ error: 'Upstream returned non-image content' })
    }
    const contentLength = resp.headers.get('content-length')
    // 与 CNB 代理同款尺寸上限：桶内非图床大对象（仅扩展名巧合）不拖垮实例带宽
    if (contentLength && Number(contentLength) > S3_PROXY_MAX_BYTES) {
      await resp.arrayBuffer().catch(() => {})
      return res.status(413).json({ error: 'Image too large to proxy' })
    }
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    if (resp.body) {
      const reader = resp.body.getReader()
      // 客户端断开时取消上游读取，避免 drain 永不到来而挂住实例
      const onClose = () => reader.cancel().catch(() => {})
      res.on('close', onClose)
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!res.write(value)) await new Promise<void>((resolve) => res.once('drain', resolve))
        }
        res.end()
      } catch {
        reader.cancel().catch(() => {})
        if (!res.headersSent) res.status(502).json({ error: 'Failed to stream from upstream' })
        else res.end()
      } finally {
        res.off('close', onClose)
        reader.releaseLock()
      }
    } else {
      const buf = await resp.arrayBuffer()
      res.send(Buffer.from(buf))
    }
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Upstream error' })
  }
}

// ---------------------------------------------------------------- 跨存储批量删除

export interface DeleteOutcome {
  ok: string[]
  failed: string[]
  skipped: number
}

/**
 * 批量删除源文件：按 URL/路径中的存储标记分组路由。
 * CNB 组走既有删除逻辑；S3 组按桶分批 DeleteObjects（单桶单批 ≤50，与 CNB 上限一致）。
 * 输入允许混传：/api/img/ 代理链接、带标记裸路径（s3-{id}/{key}）、CNB 原生路径。
 */
export async function deleteAcrossStorages(urls: string[], paths: string[]): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { ok: [], failed: [], skipped: 0 }
  const seen = new Set<string>()
  const cnbPaths: string[] = []
  const s3ByBucket = new Map<string, string[]>()

  const classify = (raw: string) => {
    if (!raw) {
      outcome.skipped++
      return
    }
    const key = `${raw}`
    if (seen.has(key)) {
      outcome.skipped++
      return
    }
    seen.add(key)
    let parsed: ParsedStoragePath | null
    if (/^s3-[a-z0-9][a-z0-9-]{0,30}\//.test(raw)) {
      parsed = parseStoragePath(raw)
    } else {
      parsed = extractStoragePath(raw)
    }
    if (!parsed) {
      outcome.skipped++
      return
    }
    if (parsed.storage === 'cnb') {
      cnbPaths.push(parsed.path)
      return
    }
    // S3：剥掉标记保留 key；key 安全校验与代理一致
    if (parsed.key.includes('..') || parsed.key.includes('\\')) {
      outcome.skipped++
      return
    }
    const list = s3ByBucket.get(parsed.id) || []
    list.push(parsed.key)
    s3ByBucket.set(parsed.id, list)
  }

  for (const u of urls) classify(typeof u === 'string' ? u : '')
  for (const p of paths) classify(typeof p === 'string' ? p : '')

  // CNB 组：既有批量删除（内部已并发）
  if (cnbPaths.length > 0) {
    const r = await deleteFromCnb([], cnbPaths)
    outcome.ok.push(...r.ok)
    outcome.failed.push(...r.failed)
    outcome.skipped += r.skipped
  }

  // S3 组：按桶并发，桶内 50 一批
  const doc = s3ByBucket.size > 0 ? await getStorageConfig() : null
  await Promise.all(
    [...s3ByBucket.entries()].map(async ([id, keys]) => {
      const bucket = findBucket(doc, id)
      if (!bucket) {
        // 桶配置已不存在：保留记录还是标记失败？——标记失败，让上层提示“桶已断开”
        outcome.failed.push(...keys.map((k) => `s3-${id}/${k}`))
        return
      }
      const s3cfg = toS3Config(bucket)
      for (let i = 0; i < keys.length; i += 50) {
        const batch = keys.slice(i, i + 50)
        const r = await s3DeleteObjects(s3cfg, batch)
        outcome.ok.push(...r.ok.map((k) => `s3-${id}/${k}`))
        outcome.failed.push(...r.failed.map((k) => `s3-${id}/${k}`))
      }
    }),
  )
  return outcome
}

// ---------------------------------------------------------------- 分桶用量（记录派生）

export interface S3BackendUsage {
  id: string
  label: string
  available: boolean
  reason?: string
  usedBytes?: number
  count?: number
  /** 空间配额（字节）；null = 不限 */
  quotaBytes?: number | null
  truncated?: boolean
}

/**
 * 单桶用量：由上传记录聚合（云端 KV，按桶独立计账，删除/清理后同步增减），
 * 不再对桶做 ListObjectsV2 全量列举（大桶慢且暴露孤儿差异）。
 * 数据新鲜度跟随配置缓存的 5 秒 TTL（记录派生数据随每次上传变化，不宜长缓存）。
 */
export async function getS3BackendUsage(bucket: StorageBucket, force = false): Promise<S3BackendUsage> {
  const stats = await getStorageStats(force)
  const s = stats[bucket.id]
  return {
    id: bucket.id,
    label: bucket.label,
    available: true,
    usedBytes: s?.size ?? 0,
    count: s?.count ?? 0,
    quotaBytes: bucket.quotaBytes ?? null,
  }
}

/** 上传配额校验：返回 null 表示允许；否则返回拒绝原因文案 */
export async function checkQuotaForUpload(bucket: StorageBucket, incomingBytes: number): Promise<string | null> {
  if (!bucket.quotaBytes || bucket.quotaBytes <= 0) return null
  const stats = await getStorageStats()
  const used = (stats[bucket.id]?.size ?? 0) + takePendingBytes(bucket.id)
  if (used + incomingBytes <= bucket.quotaBytes) {
    // 乐观计账：同实例内的批量并发上传逐笔累加，避免 5s 缓存窗口内 N 个文件共用同一旧值全部放行
    addPendingBytes(bucket.id, incomingBytes)
    return null
  }
  const fmt = (n: number) => {
    const gb = n / 1024 ** 3
    if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
    const mb = n / 1024 ** 2
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
    return `${Math.max(1, Math.round(n / 1024))} KB`
  }
  return `存储空间已满：该桶已用 ${fmt(used)} / 配额 ${fmt(bucket.quotaBytes)}，无法继续上传（请清理图片或调大配额）`
}

// 批量并发上传的在途计账：检查通过即计入，成功落盘后由 confirmPendingBytes 转入统计缓存；
// 超时（上传失败/实例异常）自动过期，不产生永久占位
const pendingBytes = new Map<string, { bytes: number; at: number }>()
const PENDING_TTL_MS = 60_000

function addPendingBytes(bucketId: string, bytes: number) {
  const cur = pendingBytes.get(bucketId)
  if (cur && Date.now() - cur.at < PENDING_TTL_MS) {
    cur.bytes += bytes
    cur.at = Date.now()
  } else {
    pendingBytes.set(bucketId, { bytes, at: Date.now() })
  }
}

function takePendingBytes(bucketId: string): number {
  const cur = pendingBytes.get(bucketId)
  if (!cur || Date.now() - cur.at >= PENDING_TTL_MS) {
    pendingBytes.delete(bucketId)
    return 0
  }
  return cur.bytes
}

/** 上传成功后：把在途字节结算进统计缓存（扣除在途 + 累加已用，同实例后续检查立即可见） */
export function confirmPendingBytes(bucketId: string, bytes: number) {
  const cur = pendingBytes.get(bucketId)
  if (cur) cur.bytes = Math.max(0, cur.bytes - bytes)
  if (configCache) {
    const s = (configCache.stats[bucketId] = configCache.stats[bucketId] || { count: 0, size: 0 })
    s.size += bytes
    s.count += 1
  }
}

/** 上传失败时退回在途计账，避免占位挤占配额 */
export function releasePendingBytes(bucketId: string, bytes: number) {
  const cur = pendingBytes.get(bucketId)
  if (cur) cur.bytes = Math.max(0, cur.bytes - bytes)
}
