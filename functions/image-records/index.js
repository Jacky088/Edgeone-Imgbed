const PREFIX = 'image_'

function json(code, msg, data, status = 200) {
  return new Response(JSON.stringify({ code, msg, data }), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
}

function isAuthorized(request, env) {
  if (!env?.SITE_PASSWORD) return true
  return request.headers.get('authorization') === 'Bearer authorized'
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

export async function onRequest({ request, env }) {
  try {
    if (!isAuthorized(request, env)) {
      return json(401, '未授权访问', null, 401)
    }

    if (request.method === 'GET') {
      return json(0, '获取成功', await listRecords())
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

    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return json(1, 'ID不能为空', null, 400)

      const safeId = id.replace(/[^a-zA-Z0-9_]/g, '')
      await IMG_RECORDS_KV.delete(`${PREFIX}${safeId}`)
      return json(0, '删除成功', null)
    }

    return json(405, '不支持的请求方法', null, 405)
  } catch (error) {
    console.error('KV operation failed:', error)
    return json(1, 'KV 存储操作失败，请检查命名空间绑定', null, 500)
  }
}
