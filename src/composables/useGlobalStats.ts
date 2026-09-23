import { ref } from 'vue'
import axios from '@/utils/axios'

// 全站图片统计：AppShell 挂载时拉一次 ?stats=1，全站侧栏存储卡共用
// （各页面不再各自传 stats，避免部分页面无数据、部分页面有数据的不一致）
export interface GlobalStats {
  count: number
  totalSize: number
  trashed: number
  todayCount?: number
}

const stats = ref<GlobalStats | null>(null)
let fetching: Promise<void> | null = null

export function useGlobalStats() {
  const fetchStats = async (force = false) => {
    if (fetching) return fetching
    if (stats.value && !force) return
    fetching = (async () => {
      try {
        const { data } = await axios.get('/image-records', {
          baseURL: '',
          params: { stats: 1 },
        })
        if (data?.code === 0 && !Array.isArray(data.data)) {
          stats.value = data.data.stats ?? null
        }
      } catch {
        // 失败保持 null，存储卡降级显示配额
      } finally {
        fetching = null
      }
    })()
    return fetching
  }

  // 上传/删除后调用：静默刷新侧栏数字
  const refreshStats = () => fetchStats(true)

  return { stats, fetchStats, refreshStats }
}
