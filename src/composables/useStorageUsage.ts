import { ref } from 'vue'
import axios from '@/utils/axios'

// 与 node-functions /api/storage/usage 的多存储返回对应：
//   cnb：CNB 官方接口（图片清单 + 组织用量/额度），available=false 时带降级原因
//   backends：各 S3 桶的 ListObjectsV2 汇总（无配额概念，仅已用体积与对象数）
export interface CnbImagesUsage {
  count: number
  usedBytes: number
  truncated?: boolean
}

export interface CnbUsagePart {
  available: boolean
  reason?: string
  detail?: string
  images?: CnbImagesUsage | null
  imagesReason?: string
  object?: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
  git?: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
}

export interface S3BackendUsage {
  id: string
  label: string
  available: boolean
  reason?: string
  usedBytes?: number
  count?: number
  /** 空间配额（字节）；null = 不限 ♾️ */
  quotaBytes?: number | null
  truncated?: boolean
}

export interface StorageUsageData {
  cnb: CnbUsagePart
  backends: S3BackendUsage[]
}

type UsageStatus = 'idle' | 'loading' | 'ok' | 'error'

// 后端 reason → 用户可读的具体原因（对应 /api/storage/usage 的返回）
const REASON_MSG: Record<string, string> = {
  forbidden: '访问令牌缺少 group-resource:r 权限',
  'missing-env': '服务端未配置 SLUG_IMG 或 TOKEN_IMG',
  upstream: 'CNB 容量接口返回异常',
  network: 'CNB 容量接口连接失败',
}

/** CNB 部分降级原因 → 用户可读文案（侧栏/设置页共用） */
export function cnbUsageErrorText(part: CnbUsagePart | null | undefined): string {
  if (!part) return 'CNB 容量接口不可用'
  const base = (part.reason && REASON_MSG[part.reason]) || 'CNB 容量接口不可用'
  return part.detail ? `${base}（${part.detail}）` : base
}

// 模块级单例：全站侧栏共用一次探测结果
const status = ref<UsageStatus>('idle')
const data = ref<StorageUsageData | null>(null)
const errorMsg = ref('')
let started = false // 本会话已发起过首次加载；失败后仍可通过 fetchUsage(true) 重试

export function useStorageUsage() {
  const fetchUsage = async (force = false) => {
    if (status.value === 'loading') return
    if (!force && started) return
    started = true
    status.value = 'loading'
    try {
      const { data: resp } = await axios.get('/storage/usage', {
        params: force ? { refresh: 1 } : undefined,
      })
      if (resp?.code === 0 && resp.data?.cnb) {
        data.value = {
          cnb: resp.data.cnb as CnbUsagePart,
          backends: Array.isArray(resp.data.backends) ? resp.data.backends : [],
        }
        status.value = 'ok'
      } else {
        const base = resp?.data?.cnb?.reason
          ? REASON_MSG[resp.data.cnb.reason] || resp?.msg || 'CNB 容量接口不可用'
          : resp?.msg || '容量接口不可用'
        // detail 为后端附加的诊断信息（如 CNB 真实 HTTP 状态码）
        errorMsg.value = resp?.data?.cnb?.detail ? `${base}（${resp.data.cnb.detail}）` : base
        status.value = 'error'
      }
    } catch {
      errorMsg.value = '容量读取失败，请检查令牌权限后重试'
      status.value = 'error'
    }
  }
  return { status, data, errorMsg, fetchUsage }
}
