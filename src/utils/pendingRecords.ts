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

/** 管理页挂载时调用：重试补写队列里的记录，返回补写成功条数 */
export async function flushPendingRecords(): Promise<number> {
  const queue = loadPendingRecords()
  if (queue.length === 0) return 0
  const rest: PendingRecord[] = []
  let ok = 0
  for (const record of queue) {
    try {
      await axios.post('/image-records', record, { baseURL: '' })
      ok++
    } catch {
      rest.push(record)
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
