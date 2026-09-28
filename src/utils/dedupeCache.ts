// 内容寻址去重（秒传）辅助：对压缩后的产物计算 SHA-256，
// 与本机会话内已上传的 (hash → 记录) 对照，命中则跳过 CNB 上传直接复用链接。
// 查重范围限定本会话内存表：零网络往返、零服务端改动；跨会话去重由服务端
// upsert 的「同 URL 幂等」逻辑兜底（同名重复上传不会产生重复记录）。

export interface DedupEntry {
  url: string
  thumbnailUrl?: string
  recordId: string
  name: string
  size: number
  type: string
  createdAt: number
}

const table = new Map<string, DedupEntry>()

/** Web Crypto 不可用（非安全上下文/旧浏览器）时返回 null，调用方走正常上传 */
export async function hashBlob(blob: Blob): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null
    const buf = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    const bytes = new Uint8Array(digest)
    // 十六进制串（64 字符），仅作会话内 key 使用
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return hex
  } catch {
    return null
  }
}

/** 命中返回已有记录；调用方据此跳过上传并直接 emit 结果 */
export function lookupHash(hash: string): DedupEntry | null {
  return table.get(hash) ?? null
}

export function rememberHash(hash: string, entry: DedupEntry): void {
  table.set(hash, entry)
  // 防膨胀：会话内最多缓存 2000 条，超出后按插入序淘汰（Map 保持插入序）
  if (table.size > 2000) {
    const first = table.keys().next().value
    if (first !== undefined) table.delete(first)
  }
}
