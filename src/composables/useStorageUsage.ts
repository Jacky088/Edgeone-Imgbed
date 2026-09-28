import { ref } from 'vue'
import axios from '@/utils/axios'

// 与 node-functions/api/_utils.ts 的 CnbStorageUsage 对应
export interface CnbStorageUsage {
  /** 本仓库图片总量（slug_img 资产 size_in_byte 之和）；清单不可读时为 null */
  images: { count: number; usedBytes: number; truncated?: boolean } | null
  /** 图片清单读取失败原因（images 为 null 时有值） */
  imagesReason?: string
  /** 组织对象存储用量/额度（含 git lfs、制品、附件） */
  object: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
  /** 组织 git 存储用量/额度（不含 lfs） */
  git: { usedBytes: number; quotaBytes: number | null; freeBytes: number | null }
}

type UsageStatus = 'idle' | 'loading' | 'ok' | 'error'

// 后端 reason → 用户可读的具体原因（对应 node-functions /api/storage/usage 的返回）
const REASON_MSG: Record<string, string> = {
  forbidden: '访问令牌缺少 group-resource:r 权限',
  'missing-env': '服务端未配置 SLUG_IMG 或 TOKEN_IMG',
  upstream: 'CNB 容量接口返回异常',
  network: 'CNB 容量接口连接失败',
}

// 模块级单例：全站侧栏共用一次探测结果
const status = ref<UsageStatus>('idle')
const data = ref<CnbStorageUsage | null>(null)
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
      if (resp?.code === 0 && resp.data?.available) {
        data.value = resp.data as CnbStorageUsage
        status.value = 'ok'
      } else {
        errorMsg.value = REASON_MSG[resp?.data?.reason] || resp?.msg || 'CNB 容量接口不可用'
        status.value = 'error'
      }
    } catch {
      errorMsg.value = 'CNB 容量读取失败，请检查令牌权限后重试'
      status.value = 'error'
    }
  }
  return { status, data, errorMsg, fetchUsage }
}
