import { ref } from 'vue'
import axios from '@/utils/axios'

// 全站图片统计：AppShell 挂载时拉一次 ?stats=1，全站侧栏存储卡共用
// （各页面不再各自传 stats，避免部分页面无数据、部分页面有数据的不一致）
export interface GlobalStats {
  count: number
  totalSize: number
  trashed: number
  trashedSize?: number
  todayCount?: number
}

const stats = ref<GlobalStats | null>(null)
let fetching: Promise<void> | null = null
// records 拉取与 stats 共用 inflight：首页 recent 拉取与侧栏统计去重
let recordsFetching: Promise<unknown[]> | null = null

// stats + 可选 records 一次性拉取；records 请求在并发间共享，避免重复全表扫描
async function fetchStatsAndRecords(
  params: Record<string, number | string>,
): Promise<{ stats: GlobalStats | null; records: unknown[] } | null> {
  try {
    const { data } = await axios.get('/image-records', {
      baseURL: '',
      // tz：让服务端"今日上传"按本机时区 0 点切分（边缘函数跑在 UTC）
      params: { ...params, tz: new Date().getTimezoneOffset() },
    })
    if (data?.code === 0 && !Array.isArray(data.data)) {
      if (data.data.stats) stats.value = data.data.stats
      return {
        stats: data.data.stats ?? null,
        records: data.data.records ?? [],
      }
    }
  } catch {
    // 失败保持 null，存储卡降级显示配额
  }
  return null
}

function dedup(
  current: Promise<unknown> | null,
  run: () => Promise<unknown>,
  setFetching: (p: Promise<unknown> | null) => void,
): Promise<unknown> {
  if (current) return current
  const p = run().finally(() => setFetching(null))
  setFetching(p)
  return p
}

export function useGlobalStats() {
  const fetchStats = async (force = false) => {
    if (stats.value && !force) return
    await dedup(fetching, async () => {
      const result = await fetchStatsAndRecords({ stats: 1 })
      if (result?.stats) stats.value = result.stats
    }, (p) => (fetching = p as Promise<void> | null))
  }

  // 首页最近上传专用：recent=N + stats 一次拿全；与 AppShell 的 stats 拉取合并
  const fetchRecentWithStats = async (n: number) => {
    const pendingRecords = recordsFetching
    if (pendingRecords) {
      await pendingRecords
      return null
    }
    return dedup(recordsFetching, async () => {
      const result = await fetchStatsAndRecords({ stats: 1, recent: n })
      return result?.records ?? []
    }, (p) => (recordsFetching = p as Promise<unknown[]> | null)) as Promise<unknown[]>
  }

  // 上传/删除后调用：静默刷新侧栏数字
  const refreshStats = () => fetchStats(true)

  return { stats, fetchStats, refreshStats, fetchRecentWithStats }
}
