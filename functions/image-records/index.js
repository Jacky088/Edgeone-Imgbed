// 软删除记录保留 30 天，过期由读取时惰性清理（SOFT_DELETE_TTL_MS 与 PREFIX 均定义于 _lib.js）

import {
  json,
  isAuthorized,
  isRateLimited,
  getClientIp,
  safeIdOf,
  recordKeyOf,
  readIndex,
  buildIndex,
  buildStats,
  writeIndex,
  snapshot,
  purgeExpired,
  sortRecords,
  cnbImgPathOf,
  listCnbImgAssets,
  deleteCnbImgFiles,
  readStorageConfig,
  writeStorageConfig,
  maskBucket,
  validateBucketInput,
  recordSources,
  verifyInternalAuth,
  deleteS3ViaNode,
  normalizeSiteSettings,
  readSiteSettings,
  writeSiteSettings,
  buildStorageBreakdown,
} from './_lib.js'

// 每条记录落盘的最简形状（拒绝非法/多余字段，宽高在此持久化）
// 字段长度上限：索引条目直接包含这些字段，超长值会把索引推入分片膨胀
function normalizeRecord(record) {
  const size = Number(record.size)
  const width = Number(record.width)
  const height = Number(record.height)
  const clip = (v, max) => {
    const s = String(v ?? '')
    return s.length > max ? s.slice(0, max) : s
  }
  return {
    id: record.id,
    name: clip(record.name, 200),
    url: clip(record.url, 1024),
    thumbnailUrl: record.thumbnailUrl ? clip(record.thumbnailUrl, 1024) : undefined,
    size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
    type: clip(record.type, 100),
    createdAt: Number(record.createdAt) || Date.now(),
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined,
  }
}

// 幂等写：同 id / 同 URL 已存在时更新原记录而不是重复新增（前端重试/秒传补记均安全）
async function upsertRecord(normalized) {
  const existing = await IMG_RECORDS_KV.get(recordKeyOf(safeIdOf(normalized.id)), { type: 'json' })
  // URL 相同视为同一张图：保留原 id 与 createdAt，仅刷新元数据
  if (!existing) {
    const all = await readIndex()
    if (all) {
      const byUrl = all.find((r) => r.url === normalized.url && !r.deletedAt)
      if (byUrl) {
        normalized.id = byUrl.id
        normalized.createdAt = byUrl.createdAt
      }
    }
  }
  await IMG_RECORDS_KV.put(recordKeyOf(safeIdOf(normalized.id)), JSON.stringify(normalized))
  await updateIndex(normalized)
  return normalized
}

// 单条记录变更后同步索引（读改写；索引缺失时以空数组起步并写入，
// 避免依赖"下次读取自动重建"——KV.list 不可用时该假设不成立，记录会被埋掉）
async function updateIndex(normalized) {
  const index = (await readIndex()) || []
  const entry = {
    id: normalized.id,
    name: normalized.name,
    url: normalized.url,
    thumbnailUrl: normalized.thumbnailUrl,
    size: normalized.size,
    type: normalized.type,
    createdAt: normalized.createdAt,
    width: normalized.width,
    height: normalized.height,
    deletedAt: undefined,
  }
  const pos = index.findIndex((r) => r.id === normalized.id)
  if (pos >= 0) index[pos] = { ...index[pos], ...entry, deletedAt: index[pos].deletedAt }
  else index.unshift(entry)
  await writeIndex(index)
}

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url)

    // 内部端点（node 函数读取桶配置文档）：不走用户登录态，用 x-internal-auth HMAC 互信
    // stats = 按桶聚合的累计上传统计（上传配额强制校验的数据源，随配置同取省一次往返）
    if (url.searchParams.get('storage-internal') === '1') {
      if (!(await verifyInternalAuth(request, env))) {
        return json(1, '内部鉴权失败', null, 401)
      }
      const doc = await readStorageConfig()
      const index = (await readIndex()) || (await snapshot())
      return json(0, '获取成功', { ...doc, stats: buildStorageBreakdown(index) })
    }

    if (!(await isAuthorized(request, env))) {
      return json(401, '未授权访问', null, 401)
    }

    const ip = getClientIp(request)

    // 写操作更严格；批量写单独放宽（一次请求写多条，请求数反而更少）
    if (request.method !== 'GET') {
      if (await isRateLimited(`write:${ip}`, 120)) {
        return json(429, '请求过于频繁，请稍后再试', null, 429)
      }
    } else if (await isRateLimited(`read:${ip}`, 120)) {
      return json(429, '请求过于频繁，请稍后再试', null, 429)
    }

    // 单次快照（默认快路径只读索引；?verify=1 逐条对齐本体；force 时全表扫描重建）
    // + 惰性清理（顺带有界清理过期记录的 CNB 原图，失败留待孤儿扫描兜底）
    async function records(force = false, verify = false) {
      const all = await snapshot(force, verify)
      return purgeExpired(all, env, true)
    }

    // CNB 孤儿文件扫描：?cnb-assets=1（边缘函数按文件路由，子路径不会进入本文件，
    // 必须走基础路径 + 查询参数，与 ?stats=1 / ?trash=1 同模式）；只读不删
    if (request.method === 'GET' && url.searchParams.get('cnb-assets') === '1') {
      const listed = await listCnbImgAssets(env)
      if (!listed.ok) {
        const msgs = {
          'missing-env': '缺少 SLUG_IMG 或 TOKEN_IMG 配置',
          forbidden: '访问令牌缺少 repo-manage:r 权限',
          upstream: 'CNB 资产接口返回异常',
          network: 'CNB 资产接口连接失败',
        }
        // 200 + code:1 让具体原因直达前端；非 2xx 会被 axios 抛异常吞掉原因
        return json(1, msgs[listed.reason] || 'CNB 资产接口不可用', null)
      }
      // 引用集 = 全部记录（含回收站，软删除的图仍可能被恢复）的主图 + 缩略图 imgPath
      const all = await records()
      const referenced = new Set()
      for (const record of all) {
        for (const u of [record.url, record.thumbnailUrl]) {
          const p = cnbImgPathOf(u)
          if (p) referenced.add(p)
        }
      }
      const orphans = listed.assets.filter((asset) => !referenced.has(asset.path))
      return json(0, '获取成功', {
        scanned: listed.assets.length + listed.others,
        otherTypes: listed.others,
        orphans: orphans.slice(0, 1000),
        orphansTruncated: orphans.length > 1000,
        truncated: listed.truncated,
      })
    }

    // ===== 站点设置云端同步（上传偏好 + 主题；登录即拉取，全设备一致）=====

    if (request.method === 'GET' && url.searchParams.get('site-settings') === '1') {
      return json(0, '获取成功', await readSiteSettings())
    }

    if (request.method === 'POST' && url.searchParams.get('site-settings') === '1') {
      const body = await request.json().catch(() => null)
      const normalized = normalizeSiteSettings(body)
      if (!normalized) return json(1, '设置内容无效', null, 400)
      const saved = await writeSiteSettings(normalized)
      if (!saved.ok) return json(1, saved.msg, null, 400)
      return json(0, '已同步', saved.doc)
    }

    // ===== 多存储桶管理（设置页桶卡片；S3 凭证只在服务端流转，掩码列表不含密钥）=====

    // 桶列表（掩码）+ 当前默认后端
    if (request.method === 'GET' && url.searchParams.get('storage-list') === '1') {
      const doc = await readStorageConfig()
      return json(0, '获取成功', { active: doc.active, buckets: doc.buckets.map(maskBucket) })
    }

    if (request.method === 'POST') {
      // 保存桶（新增/编辑共用：id 已存在即编辑；保存前的连接检测由前端先调 node /api/storage/test）
      if (url.searchParams.get('storage-bucket') === '1') {
        const body = await request.json().catch(() => null)
        const doc = await readStorageConfig()
        const checked = validateBucketInput(body, doc)
        if (!checked.ok) return json(1, checked.msg, null, 400)
        const pos = doc.buckets.findIndex((b) => b.id === checked.value.id)
        if (pos >= 0) doc.buckets[pos] = checked.value
        else doc.buckets.push(checked.value)
        await writeStorageConfig(doc)
        return json(0, '已保存', maskBucket(checked.value))
      }

      // 切换全局默认后端（全局生效：新上传进所选后端，旧图原地不动）
      if (url.searchParams.get('storage-active') === '1') {
        const body = await request.json().catch(() => null)
        const target = String(body?.active || '').trim()
        const doc = await readStorageConfig()
        if (target !== 'cnb' && !doc.buckets.some((b) => b.id === target)) {
          return json(1, '目标存储不存在', null, 400)
        }
        doc.active = target
        await writeStorageConfig(doc)
        return json(0, target === 'cnb' ? '已切换回 CNB 存储' : `默认存储已切换为 ${target}`, { active: target })
      }

      // 回写连接检测结果（设置页"检测"按钮：node 四步探测成功后更新状态）
      if (url.searchParams.get('storage-test-result') === '1') {
        const body = await request.json().catch(() => null)
        const id = String(body?.id || '')
        const doc = await readStorageConfig()
        const bucket = doc.buckets.find((b) => b.id === id)
        if (!bucket) return json(1, '存储桶不存在', null, 404)
        if (body?.ok === true) {
          bucket.lastTestAt = Date.now()
          bucket.lastTestOk = true
        } else {
          bucket.lastTestAt = Date.now()
          bucket.lastTestOk = false
        }
        await writeStorageConfig(doc)
        return json(0, '已更新', maskBucket(bucket))
      }
    }

    // 删除桶：引用检查（仍有记录指向时拒绝）→ 删除；若是当前默认后端则自动切回 CNB
    if (request.method === 'DELETE' && url.searchParams.get('storage-bucket') === '1') {
      const id = url.searchParams.get('id') || ''
      const doc = await readStorageConfig()
      const bucket = doc.buckets.find((b) => b.id === id)
      if (!bucket) return json(1, '存储桶不存在', null, 404)
      // 引用检查：索引缺失时回退全量扫描，绝不能因快路径拿不到索引而放行删除
      const index = (await readIndex()) || (await records(true))
      const marker = `/api/img/s3-${id}/`
      let refs = 0
      for (const entry of index || []) {
        if ((entry.url && entry.url.includes(marker)) || (entry.thumbnailUrl && entry.thumbnailUrl.includes(marker))) refs++
      }
      if (refs > 0) {
        return json(1, `该存储桶仍被 ${refs} 张图片引用，请先删除或迁移对应图片`, { refs })
      }
      doc.buckets = doc.buckets.filter((b) => b.id !== id)
      let switchedBackToCnb = false
      if (doc.active === id) {
        doc.active = 'cnb'
        switchedBackToCnb = true
      }
      await writeStorageConfig(doc)
      return json(0, switchedBackToCnb ? '已删除，默认存储已切回 CNB' : '已删除', { switchedBackToCnb })
    }

    if (request.method === 'GET') {
      // ?rebuild=1：跳过索引强制全表扫描重建（索引被误清/丢失时的恢复工具，
      // 也是 KV.list 可用性的试金石——返回 0 条即平台不支持扫描，需另寻恢复手段）
      // ?verify=1：逐条读取记录本体对齐索引（低频校验工具，可剔除本体已丢失的幽灵条目）
      const forceRebuild = url.searchParams.get('rebuild') === '1'
      const verifyIndex = url.searchParams.get('verify') === '1'
      const all = await records(forceRebuild, verifyIndex)
      // 默认只返回未删除记录；?trash=1 返回回收站
      const showTrash = url.searchParams.get('trash') === '1'
      const filtered = showTrash ? all.filter((r) => r.deletedAt) : all.filter((r) => !r.deletedAt)
      // ?tz=前端 getTimezoneOffset()：让"今日上传"按用户本地 0 点切分（边缘函数跑在 UTC）
      const tzRaw = url.searchParams.get('tz')
      const tz = tzRaw === null ? null : Number(tzRaw)
      const stats = buildStats(all, tz)

      if (forceRebuild) {
        const rebuilt = sortRecords(filtered, 'createdAt', 'desc')
        return json(0, `索引已重建：有效 ${rebuilt.length} 条，回收站 ${stats.trashed} 条`, {
          records: rebuilt,
          total: rebuilt.length,
          stats,
        })
      }

      // ?recent=N：只取最近 N 张（首页"最近上传"专用，避免全量下发）
      const recentParam = Number(url.searchParams.get('recent'))
      if (Number.isFinite(recentParam) && recentParam > 0) {
        const n = Math.min(50, Math.round(recentParam))
        const slice = sortRecords(filtered, 'createdAt', 'desc').slice(0, n)
        return json(0, '获取成功', { records: slice, stats })
      }

      // 服务端排序 + 分页：?sort=name|size|createdAt&dir=asc|desc&limit=&offset=
      const sortKey = ['name', 'size', 'createdAt'].includes(url.searchParams.get('sort'))
        ? url.searchParams.get('sort')
        : 'createdAt'
      const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc'
      const sorted = sortRecords(filtered, sortKey, dir)

      const limitParam = Number(url.searchParams.get('limit'))
      const offsetParam = Number(url.searchParams.get('offset'))
      if (Number.isFinite(limitParam) && limitParam > 0) {
        const limit = Math.min(500, Math.round(limitParam))
        const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.round(offsetParam) : 0
        return json(0, '获取成功', {
          records: sorted.slice(offset, offset + limit),
          total: sorted.length,
          stats,
        })
      }

      // 兼容旧形状：不带分页参数时仍全量返回（含 ?stats=1 顺带统计）
      if (url.searchParams.get('stats') === '1') {
        return json(0, '获取成功', { records: sorted, stats })
      }
      return json(0, '获取成功', sorted)
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => null)
      // 批量写：{ records: [...] }（上限 50 条/次；批量写后一次性重建索引，避免 N 次读改写）
      if (body && Array.isArray(body.records)) {
        // 超限明确拒绝（旧逻辑静默丢弃第 51 条起，调用方无从感知）
        if (body.records.length > 50) return json(1, '单次最多 50 条记录', null, 400)
        const items = body.records.slice(0, 50)
        if (items.length === 0) return json(1, '记录列表为空', null, 400)
        const invalid = items.findIndex((r) => !r?.id || !r?.url || !r?.createdAt)
        if (invalid >= 0) return json(1, `第 ${invalid + 1} 条记录缺少必要字段`, null, 400)

        const normalizedItems = items.map((raw) => normalizeRecord(raw))
        // 先整体校验再落盘：避免部分写入后才因非法 ID 失败（旧逻辑会留下半批本体）
        for (const normalized of normalizedItems) {
          if (!safeIdOf(normalized.id)) return json(1, '无效的记录 ID', null, 400)
        }
        await Promise.all(
          normalizedItems.map((normalized) =>
            IMG_RECORDS_KV.put(recordKeyOf(safeIdOf(normalized.id)), JSON.stringify(normalized)),
          ),
        )
        // 合并写入索引：现快照（快路径=1 次索引读；缺失时自动扫描重建）+ 本次提交。
        // 此前直接用写入前的旧快照重建，新记录永远进不了索引（接口返回成功但列表不可见）——批量记录丢失的根因
        // 同 id 已存在时也必须用本次字段覆写索引条目（清除 deletedAt、刷新 name/size 等）：
        // 否则回收站中的记录被客户端重传后，索引仍标记删除，快路径 purge 会把刚重传的本体物理删除
        const all = await records()
        const byId = new Map(normalizedItems.map((n) => [n.id, n]))
        const existingIds = new Set(all.map((r) => r.id))
        const freshIds = new Set()
        const fresh = buildIndex(normalizedItems).filter((e) => {
          if (existingIds.has(e.id) || freshIds.has(e.id)) return false
          freshIds.add(e.id)
          return true
        })
        const merged = [...fresh, ...all]
          .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
          .map((entry) => {
            const n = byId.get(entry.id)
            if (!n) return entry
            return {
              ...entry,
              name: n.name,
              url: n.url,
              thumbnailUrl: n.thumbnailUrl,
              size: n.size,
              type: n.type,
              createdAt: n.createdAt,
              width: n.width,
              height: n.height,
              deletedAt: undefined,
            }
          })
        await writeIndex(merged)
        return json(0, `已保存 ${items.length} 条记录`, { ok: items.length })
      }

      // 单条写（兼容旧调用方）
      const record = body
      if (!record?.id || !record?.url || !record?.createdAt) {
        return json(1, '记录缺少必要字段', null, 400)
      }
      const safeId = safeIdOf(record.id)
      if (!safeId) return json(1, '无效的记录 ID', null, 400)
      const saved = await upsertRecord(normalizeRecord(record))
      return json(0, '保存成功', { id: saved.id })
    }

    // PUT：恢复回收站记录（清除 deletedAt 标记）
    if (request.method === 'PUT') {
      const ids = url.searchParams.getAll('id')
      if (ids.length === 0) return json(1, 'ID不能为空', null, 400)
      // 批量恢复：?id=a&id=b（上限 100），单条走同样路径
      const targets = ids.slice(0, 100)
      let ok = 0
      for (const id of targets) {
        const key = recordKeyOf(safeIdOf(id))
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) continue
        delete record.deletedAt
        await IMG_RECORDS_KV.put(key, JSON.stringify(record))
        ok++
      }
      if (ok > 0) {
        // 直接在索引上清除对应条目的 deletedAt（快路径不读本体，不能依赖对账回写）
        const index = await readIndex()
        if (index) {
          const targetSet = new Set(targets)
          let changed = false
          for (let i = 0; i < index.length; i++) {
            if (targetSet.has(index[i].id) && index[i].deletedAt) {
              index[i] = { ...index[i], deletedAt: undefined }
              changed = true
            }
          }
          if (changed) await writeIndex(index)
        } else {
          // 索引缺失：从本体扫描重建（本体已反映本次恢复）
          await snapshot()
        }
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
      // 彻底删除由服务端联动删除 CNB 原图（尽力而为），失败数经响应 cnbFailed 直达前端
      const targets = ids.slice(0, 100)
      const keyOf = (id) => recordKeyOf(safeIdOf(id))

      if (targets.length === 1) {
        const key = keyOf(targets[0])
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) return json(0, '已删除', null) // 幂等：重复删除不再 404
        if (purge) {
          // 先删源文件（CNB + S3），全部成功才删记录体；
          // 有失败则记录保留在回收站（deletedAt 保持），用户可重试彻底删除
          const sources = recordSources(record)
          const cnbPaths = sources.filter((x) => x.kind === 'cnb').map((x) => x.path)
          const s3Paths = sources.filter((x) => x.kind === 's3').map((x) => x.path)
          let okCnb = new Set()
          let okS3 = new Set()
          if (cnbPaths.length > 0) {
            const res = await deleteCnbImgFiles(env, cnbPaths)
            okCnb = new Set(res.ok)
          }
          if (s3Paths.length > 0) {
            const res = await deleteS3ViaNode(env, s3Paths)
            okS3 = new Set(res.ok)
          }
          const fullyPurged = sources.every((x) =>
            (x.kind === 'cnb' ? okCnb : okS3).has(x.path),
          )
          if (!fullyPurged) {
            return json(0, '源文件删除失败，记录已保留在回收站，可重试', { sourceFailed: 1, kept: 1 })
          }
          await IMG_RECORDS_KV.delete(key)
        } else {
          record.deletedAt = Date.now()
          await IMG_RECORDS_KV.put(key, JSON.stringify(record))
        }
        // 同步索引：彻底删除移除条目，软删除仅打标记（回收站视图免扫描）
        const index = await readIndex()
        if (index) {
          const pos = index.findIndex((r) => r.id === record.id)
          if (pos >= 0 && purge) {
            index.splice(pos, 1)
            await writeIndex(index)
          } else if (pos >= 0) {
            index[pos] = { ...index[pos], deletedAt: record.deletedAt }
            await writeIndex(index)
          }
        }
        return json(0, purge ? '已彻底删除' : '已移入回收站', purge ? { sourceFailed: 0 } : null)
      }
      let ok = 0
      let fail = 0
      let sourceFailed = 0
      let touched = [] // { id, deletedAt?, purge }
      const records = [] // 待删除源文件的记录（彻底删除时用）
      for (const id of targets) {
        const key = keyOf(id)
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) continue
        if (purge) {
          records.push(record)
          touched.push({ id: record.id, purge: true })
        } else {
          record.deletedAt = Date.now()
          await IMG_RECORDS_KV.put(key, JSON.stringify(record))
          touched.push({ id: record.id, deletedAt: record.deletedAt, purge: false })
        }
        ok++
      }
      // 软删除：索引直接按 id 维护（快路径不读本体，不能依赖对账回写）
      if (ok > 0 && !purge) {
        const index = await readIndex()
        if (index) {
          let changed = false
          for (const t of touched) {
            const pos = index.findIndex((r) => r.id === t.id)
            if (pos < 0) continue
            changed = true
            index[pos] = { ...index[pos], deletedAt: t.deletedAt }
          }
          if (changed) await writeIndex(index)
        } else {
          // 索引缺失：从本体扫描重建（本体已反映本次删除）
          await snapshot()
        }
      }
      // 彻底删除：先删源文件（CNB + S3，逐路径结果），全部成功的记录才删记录体；
      // 有失败的记录保留在回收站（deletedAt 保持），用户可重试
      if (purge && records.length > 0) {
        const cnbPaths = [...new Set(records.flatMap((r) => recordSources(r).filter((x) => x.kind === 'cnb').map((x) => x.path)))]
        const s3Paths = [...new Set(records.flatMap((r) => recordSources(r).filter((x) => x.kind === 's3').map((x) => x.path)))]
        let okCnb = new Set()
        let okS3 = new Set()
        if (cnbPaths.length > 0) {
          const res = await deleteCnbImgFiles(env, cnbPaths)
          okCnb = new Set(res.ok)
        }
        if (s3Paths.length > 0) {
          const res = await deleteS3ViaNode(env, s3Paths)
          okS3 = new Set(res.ok)
        }
        const fullyPurged = records.filter((r) =>
          recordSources(r).every((x) => (x.kind === 'cnb' ? okCnb : okS3).has(x.path)),
        )
        sourceFailed = records.length - fullyPurged.length
        if (fullyPurged.length > 0) {
          const purgedIds = new Set(fullyPurged.map((r) => r.id))
          for (let i = 0; i < fullyPurged.length; i += 100) {
            await Promise.all(
              fullyPurged.slice(i, i + 100).map((r) => IMG_RECORDS_KV.delete(recordKeyOf(safeIdOf(r.id)))),
            )
          }
          // 索引仅剔除完全清理的条目（保留的记录维持回收站标记不动）
          const index = await readIndex()
          if (index) {
            let changed = false
            for (const t of touched.filter((x) => purgedIds.has(x.id))) {
              const pos = index.findIndex((r) => r.id === t.id)
              if (pos < 0) continue
              changed = true
              index.splice(pos, 1)
            }
            if (changed) await writeIndex(index)
          } else {
            // 索引缺失：从本体扫描重建（本体已反映本次删除）
            await snapshot()
          }
          touched = touched.filter((t) => purgedIds.has(t.id))
          ok = fullyPurged.length
          fail = targets.length - ok
        } else {
          touched = []
          ok = 0
          fail = targets.length
        }
      }
      return json(0, purge
        ? sourceFailed > 0
          ? `已彻底删除 ${ok} 条，${sourceFailed} 条源文件删除失败（记录已保留在回收站，可重试）`
          : `已彻底删除 ${ok} 条记录`
        : `已删除 ${ok} 条记录`, {
        ok,
        fail,
        sourceFailed,
      })
    }

    return json(405, '不支持的请求方法', null, 405)
  } catch (error) {
    console.error('KV operation failed:', error)
    // 真实原因直达前端：笼统的"绑定丢失"提示会掩盖代码异常，无法在线诊断（fa54e90 的明确设计）。
    // 权衡：错误原文可能含 KV 细节，但调用方均为已认证用户，属可接受的诊断便利
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return json(1, `操作失败: ${reason}`, null, 500)
  }
}
