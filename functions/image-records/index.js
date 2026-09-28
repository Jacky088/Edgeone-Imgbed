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
} from './_lib.js'

// 每条记录落盘的最简形状（拒绝非法/多余字段，宽高在此持久化）
function normalizeRecord(record) {
  const size = Number(record.size)
  const width = Number(record.width)
  const height = Number(record.height)
  return {
    id: record.id,
    name: String(record.name || ''),
    url: String(record.url),
    thumbnailUrl: record.thumbnailUrl ? String(record.thumbnailUrl) : undefined,
    size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
    type: String(record.type || ''),
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
    if (!(await isAuthorized(request, env))) {
      return json(401, '未授权访问', null, 401)
    }

    const url = new URL(request.url)
    const ip = getClientIp(request)

    // 写操作更严格；批量写单独放宽（一次请求写多条，请求数反而更少）
    if (request.method !== 'GET') {
      if (await isRateLimited(`write:${ip}`, 120)) {
        return json(429, '请求过于频繁，请稍后再试', null, 429)
      }
    } else if (await isRateLimited(`read:${ip}`, 120)) {
      return json(429, '请求过于频繁，请稍后再试', null, 429)
    }

    // 单次快照（索引优先，缺失回退扫描并重建）+ 惰性清理；force 时跳过索引强制全表扫描
    async function records(force = false) {
      const all = await snapshot(force)
      return purgeExpired(all)
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

    if (request.method === 'GET') {
      // ?rebuild=1：跳过索引强制全表扫描重建（索引被误清/丢失时的恢复工具，
      // 也是 KV.list 可用性的试金石——返回 0 条即平台不支持扫描，需另寻恢复手段）
      const forceRebuild = url.searchParams.get('rebuild') === '1'
      const all = await records(forceRebuild)
      // 默认只返回未删除记录；?trash=1 返回回收站
      const showTrash = url.searchParams.get('trash') === '1'
      const filtered = showTrash ? all.filter((r) => r.deletedAt) : all.filter((r) => !r.deletedAt)
      const stats = buildStats(all)

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
      const body = await request.json()
      // 批量写：{ records: [...] }（上限 50 条/次；批量写后一次性重建索引，避免 N 次读改写）
      if (body && Array.isArray(body.records)) {
        const items = body.records.slice(0, 50)
        if (items.length === 0) return json(1, '记录列表为空', null, 400)
        const invalid = items.findIndex((r) => !r?.id || !r?.url || !r?.createdAt)
        if (invalid >= 0) return json(1, `第 ${invalid + 1} 条记录缺少必要字段`, null, 400)

        const normalizedItems = items.map((raw) => normalizeRecord(raw))
        for (const normalized of normalizedItems) {
          const safeId = safeIdOf(normalized.id)
          if (!safeId) return json(1, '无效的记录 ID', null, 400)
          await IMG_RECORDS_KV.put(recordKeyOf(safeId), JSON.stringify(normalized))
        }
        // 合并写入索引：旧快照 + 本次新记录。此前直接用写入前的旧快照重建，
        // 新记录永远进不了索引（接口返回成功但列表不可见）——批量记录丢失的根因
        const all = await records()
        const existingIds = new Set(all.map((r) => r.id))
        const freshIds = new Set()
        const fresh = buildIndex(normalizedItems).filter((e) => {
          if (existingIds.has(e.id) || freshIds.has(e.id)) return false
          freshIds.add(e.id)
          return true
        })
        const merged = [...fresh, ...all].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
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
        const all = await records()
        // 扫描结果为空时不写空索引（KV.list 可能不可用，写空索引会埋掉全部历史记录）
        if (all.length > 0) await writeIndex(buildIndex(all))
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
      const keyOf = (id) => recordKeyOf(safeIdOf(id))
      if (targets.length === 1) {
        const key = keyOf(targets[0])
        const record = await IMG_RECORDS_KV.get(key, { type: 'json' })
        if (!record) return json(0, '已删除', null) // 幂等：重复删除不再 404
        if (purge) {
          await IMG_RECORDS_KV.delete(key)
        } else {
          record.deletedAt = Date.now()
          await IMG_RECORDS_KV.put(key, JSON.stringify(record))
        }
        // 同步索引：彻底删除移除条目，软删除仅打标记（回收站视图免扫描）
        const index = await readIndex()
        if (index) {
          const pos = index.findIndex((r) => r.id === record.id)
          if (pos >= 0) {
            if (purge) index.splice(pos, 1)
            else index[pos] = { ...index[pos], deletedAt: record.deletedAt }
            await writeIndex(index)
          }
        }
        return json(0, purge ? '已彻底删除' : '已移入回收站', null)
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
      if (ok > 0) {
        const all = await records()
        // 扫描结果为空时不写空索引（KV.list 可能不可用，写空索引会埋掉全部历史记录）
        if (all.length > 0) await writeIndex(buildIndex(all))
      }
      return json(0, purge ? `已彻底删除 ${ok} 条记录` : `已删除 ${ok} 条记录`, { ok, fail: targets.length - ok })
    }

    return json(405, '不支持的请求方法', null, 405)
  } catch (error) {
    console.error('KV operation failed:', error)
    return json(1, 'KV 存储操作失败，请检查命名空间绑定', null, 500)
  }
}
