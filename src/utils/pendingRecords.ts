import axios from '@/utils/axios'

// 待补写 KV 的上传记录（CNB 已有文件但写 KV 失败时入队，避免孤儿文件）
export interface PendingRecord {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  type: string
  createdAt: number
  width?: number
  height?: number
}

const PENDING_RECORDS_KEY = 'pending_image_records'

function loadPendingRecords(): PendingRecord[] {
  try {
    const raw = localStorage.getItem(PENDING_RECORDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function enqueuePendingRecord(record: PendingRecord): void {
  try {
    const queue = loadPendingRecords()
    if (!queue.some((r) => r.id === record.id || r.url === record.url)) {
      queue.push(record)
      localStorage.setItem(PENDING_RECORDS_KEY, JSON.stringify(queue))
    }
  } catch {
    // localStorage 不可用时只能放弃补写
  }
}

/** 管理页挂载时调用：重试补写队列里的记录，返回补写成功条数。
 * 优先走批量写（50 条/批，与服务端上限一致），失败回退逐条写 */
export async function flushPendingRecords(): Promise<number> {
  const queue = loadPendingRecords()
  if (queue.length === 0) return 0
  const rest: PendingRecord[] = []
  let ok = 0

  // 先尝试批量：一次请求最多 50 条
  const batches: PendingRecord[][] = []
  for (let i = 0; i < queue.length; i += 50) {
    batches.push(queue.slice(i, i + 50))
  }
  const batchFailed: PendingRecord[] = []
  for (const batch of batches) {
    try {
      const { data } = await axios.post('/image-records', { records: batch }, { baseURL: '' })
      if (data.code === 0) ok += batch.length
      else batchFailed.push(...batch)
    } catch {
      batchFailed.push(...batch)
    }
  }

  // 批量被拒（旧版服务端不支持 records 数组）时回退逐条写
  if (batchFailed.length > 0) {
    for (const record of batchFailed) {
      try {
        await axios.post('/image-records', record, { baseURL: '' })
        ok++
      } catch {
        rest.push(record)
      }
    }
  }

  try {
    if (rest.length > 0) {
      localStorage.setItem(PENDING_RECORDS_KEY, JSON.stringify(rest))
    } else {
      localStorage.removeItem(PENDING_RECORDS_KEY)
    }
  } catch {
    // ignore
  }
  return ok
}
