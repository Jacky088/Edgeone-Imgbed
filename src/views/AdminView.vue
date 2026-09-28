<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '@/utils/axios'
import {
  Trash2,
  ExternalLink,
  FileImage,
  AlertCircle,
  Search,
  X,
  Copy,
  Braces,
  Code2,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArchiveRestore,
  Download,
  Upload,
  Keyboard,
  LayoutGrid,
  List,
  Grid2x2,
  Grid3x3,
  RefreshCw,
  SlidersHorizontal,
  MoreHorizontal,
  CheckSquare,
  Check,
  ZoomIn,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { buildFormats } from '@/utils/formatLinks'
import { formatCompactSize } from '@/utils/format'
import { copyTextFallback } from '@/utils/clipboard'
import { useUploadSettings } from '@/composables/useUploadSettings'
import { flushPendingRecords } from '@/utils/pendingRecords'
import { useGlobalStats } from '@/composables/useGlobalStats'
import AppShell from '@/components/layout/AppShell.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PaginationBar from '@/components/PaginationBar.vue'

interface ImageRecord {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  type: string
  createdAt: number
  deletedAt?: number
  width?: number
  height?: number
}

const { settings } = useUploadSettings()
const route = useRoute()
const router = useRouter()

const list = ref<ImageRecord[]>([])
const loading = ref(false)
// 回收站是 /admin 的一种视图（/admin?view=trash），与侧栏「回收站」导航项联动
const trashMode = computed({
  get: () => route.query.view === 'trash',
  set: (val: boolean) => {
    page.value = 1
    // 保留筛选参数（q/type/size/time/sort），只切换 view
    router.replace({ path: '/admin', query: buildQuery(val) }).catch(() => {})
  },
})
const stats = ref<{ count: number; totalSize: number; trashed: number; trashedSize?: number } | null>(null)

// 前端搜索 + 类型筛选 + 大小筛选 + 排序 + 分页（数据已整表拉取，不再额外请求）
const keyword = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const typeFilter = ref('all')
type SizeFilter = 'all' | 'small' | 'medium' | 'large'
const sizeFilter = ref<SizeFilter>('all')
const sizeFilterOptions: Array<{ value: SizeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'small', label: '< 100KB' },
  { value: 'medium', label: '100KB–1MB' },
  { value: 'large', label: '> 1MB' },
]
// 时间范围筛选（纯前端：createdAt 就在记录里）
type TimeFilter = 'all' | 'today' | '7d' | '30d'
const timeFilter = ref<TimeFilter>('all')
const timeFilterOptions: Array<{ value: TimeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]
const timeLabel = computed(() => timeFilterOptions.find((o) => o.value === timeFilter.value)?.label || '全部')
const showTimeMenu = ref(false)
const localMidnight = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const hasActiveFilters = computed(
  () => !!keyword.value || typeFilter.value !== 'all' || sizeFilter.value !== 'all' || timeFilter.value !== 'all',
)
const activeFilterCount = computed(
  () => [typeFilter.value !== 'all', sizeFilter.value !== 'all', timeFilter.value !== 'all'].filter(Boolean).length,
)
const clearFilters = () => {
  keyword.value = ''
  typeFilter.value = 'all'
  sizeFilter.value = 'all'
  timeFilter.value = 'all'
  page.value = 1
}
const sizeLabel = computed(
  () => sizeFilterOptions.find((o) => o.value === sizeFilter.value)?.label || '全部',
)
const typeLabel = computed(() =>
  typeFilter.value === 'all' ? '全部' : typeFilter.value.toUpperCase(),
)
const sortLabel = computed(() =>
  sortKey.value === 'createdAt' ? '上传时间' : sortKey.value === 'size' ? '大小' : '名称',
)

// 网格 / 列表视图（默认网格，与目标图一致；偏好存本机）
const viewMode = ref<'grid' | 'list'>(
  localStorage.getItem('admin_view_mode') === 'list' ? 'list' : 'grid',
)
watch(viewMode, (v) => {
  try {
    localStorage.setItem('admin_view_mode', v)
  } catch {
    // ignore
  }
})

// 网格密度（舒适 / 紧凑），偏好存本机
const gridDensity = ref<'comfortable' | 'compact'>(
  localStorage.getItem('admin_grid_density') === 'compact' ? 'compact' : 'comfortable',
)
watch(gridDensity, (v) => {
  try {
    localStorage.setItem('admin_grid_density', v)
  } catch {
    // ignore
  }
})
const gridClass = computed(() =>
  gridDensity.value === 'compact'
    ? 'grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5 2xl:grid-cols-6'
    : 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4',
)

// 顶部「批量操作」下拉与卡片「…」菜单（同一时间只开一个；点遮罩关闭）
const showBatchMenu = ref(false)
const openMenuId = ref<string | null>(null)
const showSelectMenu = ref(false)
const showFilterSheet = ref(false)
const openFilterSheet = () => {
  closeMenus()
  showFilterSheet.value = true
}
const closeMenus = () => {
  showBatchMenu.value = false
  showSortMenu.value = false
  showTypeMenu.value = false
  showSizeMenu.value = false
  showTimeMenu.value = false
  showSelectMenu.value = false
  openMenuId.value = null
}

// 类型 / 大小下拉的开关态（与排序、批量菜单互斥）
const showTypeMenu = ref(false)
const showSizeMenu = ref(false)
const page = ref(1)
const pageSize = computed(() => settings.value.pageSize)

const availableTypes = computed(() => {
  const set = new Set<string>()
  for (const item of list.value) {
    set.add((item.type || '').split('/')[1] || 'other')
  }
  return [...set].sort()
})

// 排序：默认按上传时间倒序（最新在前）
type SortKey = 'createdAt' | 'size' | 'name'
type SortDir = 'asc' | 'desc'
const sortKey = ref<SortKey>('createdAt')
const sortDir = ref<SortDir>('desc')

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'createdAt', label: '上传时间' },
  { key: 'size', label: '大小' },
  { key: 'name', label: '名称' },
]

const showSortMenu = ref(false)

// ---------- 筛选状态 ↔ URL 同步：刷新/回退/分享不丢状态（关键词写入防抖） ----------
const parseQuery = () => {
  const q = route.query
  const pick = (v: unknown, allowed: string[] | null, fallback: string) =>
    typeof v === 'string' && (!allowed || allowed.includes(v)) ? v : fallback
  keyword.value = pick(q.q, null, '')
  typeFilter.value = pick(q.type, null, 'all')
  sizeFilter.value = pick(q.size, ['all', 'small', 'medium', 'large'], 'all') as SizeFilter
  timeFilter.value = pick(q.time, ['all', 'today', '7d', '30d'], 'all') as TimeFilter
  sortKey.value = pick(q.sort, ['createdAt', 'size', 'name'], 'createdAt') as SortKey
  sortDir.value = pick(q.dir, ['asc', 'desc'], 'desc') as SortDir
  const p = Number(q.page)
  page.value = Number.isFinite(p) && p > 0 ? Math.floor(p) : 1
}

const buildQuery = (trash: boolean) => ({
  ...(trash ? { view: 'trash' } : {}),
  ...(keyword.value ? { q: keyword.value } : {}),
  ...(typeFilter.value !== 'all' ? { type: typeFilter.value } : {}),
  ...(sizeFilter.value !== 'all' ? { size: sizeFilter.value } : {}),
  ...(timeFilter.value !== 'all' ? { time: timeFilter.value } : {}),
  ...(sortKey.value !== 'createdAt' || sortDir.value !== 'desc'
    ? { sort: sortKey.value, dir: sortDir.value }
    : {}),
  ...(page.value > 1 ? { page: String(page.value) } : {}),
})

let queryTimer: number | null = null
const writeQuery = () => {
  if (queryTimer) clearTimeout(queryTimer)
  queryTimer = window.setTimeout(() => {
    router.replace({ path: '/admin', query: buildQuery(trashMode.value) }).catch(() => {})
  }, 250)
}

parseQuery()

const setSort = (key: SortKey) => {
  toggleSort(key)
  showSortMenu.value = false
}

const toggleSort = (key: SortKey) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'name' ? 'asc' : 'desc'
  }
  page.value = 1
}

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let base = list.value
  if (kw) {
    // 目标图搜索框支持文件名 / URL / 标签：标签暂无字段，先覆盖文件名 + URL
    base = base.filter(
      (item) => item.name.toLowerCase().includes(kw) || item.url.toLowerCase().includes(kw),
    )
  }
  if (typeFilter.value !== 'all') {
    base = base.filter((item) => (item.type || '').split('/')[1] === typeFilter.value)
  }
  if (sizeFilter.value !== 'all') {
    base = base.filter((item) => {
      const s = Number(item.size) || 0
      if (sizeFilter.value === 'small') return s < 100 * 1024
      if (sizeFilter.value === 'medium') return s >= 100 * 1024 && s <= 1024 * 1024
      return s > 1024 * 1024
    })
  }
  if (timeFilter.value !== 'all') {
    const start =
      timeFilter.value === 'today' ? localMidnight() : Date.now() - (timeFilter.value === '7d' ? 7 : 30) * 86400000
    base = base.filter((item) => item.createdAt >= start)
  }
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...base].sort((a, b) => {
    if (sortKey.value === 'name') return a.name.localeCompare(b.name, 'zh-CN') * dir
    if (sortKey.value === 'size') return (a.size - b.size) * dir
    return (a.createdAt - b.createdAt) * dir
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredList.value.length / pageSize.value)))
const pagedList = computed(() =>
  filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
)

watch([keyword, typeFilter, sizeFilter, timeFilter], () => {
  page.value = 1
})
// 任何筛选/分页变化写回 URL（防抖合并）
watch([keyword, typeFilter, sizeFilter, timeFilter, sortKey, sortDir, page], writeQuery)
// 从导航切换回收站/正常列表时重置分页并重新拉取（筛选保留并回写 URL）
watch(trashMode, () => {
  page.value = 1
  clearSelection()
  focusIndex.value = -1
  fetchList()
  writeQuery()
})
watch(totalPages, () => {
  if (page.value > totalPages.value) page.value = totalPages.value
})
watch(pageSize, () => {
  page.value = 1
})

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  return (bytes / 1024).toFixed(2) + ' KB'
}

const formatDate = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 搜索命中高亮：把文件名切成 [普通, 命中, 普通…] 片段
const highlightName = (name: string): Array<{ text: string; hit: boolean }> => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return [{ text: name, hit: false }]
  const lower = name.toLowerCase()
  const segments: Array<{ text: string; hit: boolean }> = []
  let from = 0
  for (;;) {
    const idx = lower.indexOf(kw, from)
    if (idx < 0) {
      segments.push({ text: name.slice(from), hit: false })
      break
    }
    if (idx > from) segments.push({ text: name.slice(from, idx), hit: false })
    segments.push({ text: name.slice(idx, idx + kw.length), hit: true })
    from = idx + kw.length
  }
  return segments
}

// 「新」角标：近 5 分钟内上传的记录（定时刷新让角标到期自动消失）
const nowTick = ref(Date.now())
let tickTimer: number | null = null
const isNewRecord = (item: ImageRecord) => nowTick.value - Number(item.createdAt) < 5 * 60 * 1000

// 回收站剩余保留天数（30 天大限）
const SOFT_DELETE_TTL_DAYS = 30
const daysLeft = (deletedAt: number) =>
  Math.max(0, Math.ceil((deletedAt + SOFT_DELETE_TTL_DAYS * 86400000 - Date.now()) / 86400000))
const daysLeftClass = (deletedAt: number) => {
  const d = daysLeft(deletedAt)
  if (d <= 3) return 'bg-red-500/10 text-red-500 dark:text-red-400'
  if (d <= 7) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
}

// 全站侧栏存储卡同步：本页 ?stats=1 顺带拿到的统计直接写入全局，省一次请求
const { stats: globalStats } = useGlobalStats()
const syncGlobalStats = () => { if (stats.value) globalStats.value = stats.value }

// 回收站页头提示：删除仅移除记录，软删除原图仍占用 CNB 存储；并给出最早一批的清理倒计时
const trashFootprintText = computed(() => {
  const parts: string[] = []
  const size = stats.value?.trashedSize ?? 0
  if (size > 0) parts.push(`原图仍占用 CNB 存储 ${formatCompactSize(size)}`)
  const deletedAts = list.value.map((r) => r.deletedAt).filter((d): d is number => !!d)
  if (deletedAts.length > 0) parts.push(`最早一批剩 ${daysLeft(Math.min(...deletedAts))} 天`)
  return `${parts.length > 0 ? parts.join('，') + '；' : ''}30 天后自动清除，可在此恢复`
})

// 列表与统计一次请求拿全（KV 侧单次全表扫描 + ?stats=1 顺带统计）；quiet 静默刷新，不闪骨架屏
const fetchList = async (quiet = false) => {
  if (!quiet) loading.value = true
  try {
    const { data } = await axios.get('/image-records', {
      baseURL: '',
      // tz：让服务端"今日上传"按本机时区 0 点切分（边缘函数跑在 UTC）
      params: { ...(trashMode.value ? { trash: 1 } : {}), stats: 1, tz: new Date().getTimezoneOffset() },
    })
    if (data.code === 0) {
      // 兼容旧形状：纯数组（无统计）；新形状：{ records, stats }
      if (Array.isArray(data.data)) {
        list.value = data.data
      } else {
        list.value = data.data.records ?? []
        stats.value = data.data.stats ?? null
        syncGlobalStats()
      }
    }
  } catch (e) {
    if (!quiet) toast.error('获取列表失败')
  } finally {
    if (!quiet) loading.value = false
  }
}

// 应用内删除确认（回收站彻底删除专用，组件为 ConfirmDialog）：单条 / 批量共用一个弹窗
const pendingDelete = ref<ImageRecord | null>(null)
const pendingBatchDelete = ref(false)
const deleting = ref(false)

const showDeleteDialog = computed(() => !!pendingDelete.value || pendingBatchDelete.value)

const closeDeleteDialog = () => {
  if (deleting.value) return
  pendingDelete.value = null
  pendingBatchDelete.value = false
}

// 缩略图点击后的大图预览（操作中心：←/→ 在当前筛选结果内切换 + 快捷操作）
const lightboxItem = ref<ImageRecord | null>(null)

const lightboxIndex = computed(() =>
  lightboxItem.value ? filteredList.value.findIndex((r) => r.id === lightboxItem.value!.id) : -1,
)

const lightboxStep = (delta: number) => {
  const total = filteredList.value.length
  if (total === 0) return
  const base = lightboxIndex.value < 0 ? 0 : lightboxIndex.value
  lightboxItem.value = filteredList.value[(base + delta + total) % total] ?? null
}

// 删除后保持预览有效：指向原位置的新记录（即"下一张"），列表空了则关闭
const snapLightboxAfterRemoval = (wasOpen: boolean, prevIndex: number) => {
  if (!wasOpen) return
  const total = filteredList.value.length
  if (total === 0) {
    lightboxItem.value = null
    return
  }
  lightboxItem.value = filteredList.value[Math.min(Math.max(prevIndex, 0), total - 1)] ?? null
}

// 预览内删除：回收站先弹确认，正常列表直接软删除（可撤销）
const deleteFromLightbox = (item: ImageRecord) => {
  if (trashMode.value) {
    pendingDelete.value = item
    pendingBatchDelete.value = false
  } else {
    softDelete(item)
  }
}

// 键盘导航：上下移动高亮，Enter 预览，Delete 删除
const focusIndex = ref(-1)

const moveFocus = (delta: number) => {
  if (filteredList.value.length === 0) return
  focusIndex.value = Math.min(
    filteredList.value.length - 1,
    Math.max(0, focusIndex.value < 0 ? 0 : focusIndex.value + delta),
  )
  // 跨页时自动翻页，保证高亮项始终可见
  const targetPage = Math.floor(focusIndex.value / pageSize.value) + 1
  if (targetPage !== page.value) page.value = targetPage
}

const focusedItem = computed(() =>
  focusIndex.value >= 0 ? filteredList.value[focusIndex.value] ?? null : null,
)

// Escape 关闭弹层（lightbox 优先于删除确认；删除请求进行中不响应）
const onKeydown = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement
  // 输入框里不劫持按键；Esc 在搜索框内 = 清空并失焦
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    if (e.key === 'Escape' && target === searchInput.value) {
      if (keyword.value) keyword.value = ''
      searchInput.value?.blur()
    }
    return
  }

  // 预览打开时接管按键：←/→ 切换、Del 删除当前预览、Esc 关闭
  if (lightboxItem.value) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      lightboxStep(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      lightboxStep(1)
    } else if (e.key === 'Delete' && !deleting.value) {
      e.preventDefault()
      deleteFromLightbox(lightboxItem.value)
    } else if (e.key === 'Escape' && !deleting.value) {
      lightboxItem.value = null
    }
    return
  }

  if (e.key === '/' && !showDeleteDialog.value) {
    e.preventDefault()
    searchInput.value?.focus()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !showDeleteDialog.value) {
    e.preventDefault()
    if (allSelected.value) clearSelection()
    else selectAllFiltered()
    return
  }
  if ((e.key === 'x' || e.key === 'X') && focusedItem.value && !showDeleteDialog.value) {
    toggleSelect(focusedItem.value.id)
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveFocus(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveFocus(-1)
    return
  }
  if (e.key === 'Enter' && focusedItem.value && !showDeleteDialog.value) {
    lightboxItem.value = focusedItem.value
    return
  }
  if (e.key === '?' && !showDeleteDialog.value) {
    showShortcuts.value = !showShortcuts.value
    return
  }
  if (e.key === 'F2' && focusedItem.value && !trashMode.value) {
    e.preventDefault()
    copyFormat(focusedItem.value, 'url')
    return
  }
  // 仅 Delete 触发删除（Backspace 常被当作"后退"，劫持容易误删；软删可恢复，但仍不加回这个习惯键）
  if (e.key === 'Delete' && focusedItem.value && !deleting.value) {
    e.preventDefault()
    if (trashMode.value) {
      pendingDelete.value = focusedItem.value
      pendingBatchDelete.value = false
    } else {
      // 正常列表直接软删除（toast 可撤销）
      softDelete(focusedItem.value)
    }
    return
  }
  if (e.key === 'Escape' && !deleting.value) {
    if (showShortcuts.value) {
      showShortcuts.value = false
    } else if (showDeleteDialog.value) {
      closeDeleteDialog()
    } else if (selectMode.value) {
      exitSelectMode()
    }
  }
}

// 单条删除：正常列表软删除进回收站（toast 可撤销），回收站里先确认再彻底删除
// （CNB 源文件删除已下沉到边缘函数 purge 流程，失败数由响应 cnbFailed 带回）
const softDelete = async (item: ImageRecord) => {
  if (deleting.value) return
  deleting.value = true
  const lightboxWasOpen = lightboxItem.value?.id === item.id
  const prevLightboxIndex = lightboxIndex.value
  try {
    const { data } = await axios.delete('/image-records', {
      baseURL: '',
      params: trashMode.value ? { id: item.id, purge: 1 } : { id: item.id },
    })
    if (data.code === 0) {
      list.value = list.value.filter((row) => row.id !== item.id)
      if (trashMode.value) {
        if ((data.data?.cnbFailed ?? 0) === 0) {
          toast.success('已彻底删除（含 CNB 源文件）')
        } else {
          toast.warning('记录已彻底删除；部分 CNB 源文件删除失败')
        }
      } else {
        toast.success('已移入回收站，30 天内可恢复', {
          action: { label: '撤销', onClick: () => restoreRecords([item], '已恢复') },
          duration: 5000,
        })
      }
      snapLightboxAfterRemoval(lightboxWasOpen, prevLightboxIndex)
      fetchList(true)
    } else {
      toast.error(data.msg)
    }
  } catch (e) {
    toast.error('删除失败')
  } finally {
    deleting.value = false
    pendingDelete.value = null
  }
}

// 兼容确认弹窗按钮：trashMode 决定软删或彻底删除
const handleDelete = (item: ImageRecord) => softDelete(item)

// 批量恢复 / 撤销软删除共用：PUT 批量恢复后本地即时移除并刷新列表与侧栏统计
const restoreRecords = async (items: ImageRecord[], successMsg: string) => {
  if (items.length === 0) return
  try {
    const { data } = await axios.put(`/image-records?${idsParams(items)}`, {}, { baseURL: '' })
    if (data.code === 0) {
      const done = new Set(items.map((i) => i.id))
      list.value = list.value.filter((row) => !done.has(row.id))
      toast.success(successMsg)
      fetchList(true)
    } else {
      toast.error(data.msg || '恢复失败')
    }
  } catch {
    toast.error('恢复失败')
  }
}

// 查询串组装 ?id=a&id=b（与 KV 侧 getAll('id') 批量路径配套）
const idsParams = (items: ImageRecord[]) => items.map((i) => `id=${encodeURIComponent(i.id)}`).join('&')

const restoreBatch = async () => {
  const items = [...selectedList.value]
  if (items.length === 0) return
  await restoreRecords(items, items.length > 1 ? `已恢复 ${items.length} 条记录` : '已恢复到列表')
  clearSelection()
}

const restoreItem = async (item: ImageRecord) => {
  const lightboxWasOpen = lightboxItem.value?.id === item.id
  const prevLightboxIndex = lightboxIndex.value
  try {
    const { data } = await axios.put('/image-records', {}, { baseURL: '', params: { id: item.id } })
    if (data.code === 0) {
      list.value = list.value.filter((row) => row.id !== item.id)
      snapLightboxAfterRemoval(lightboxWasOpen, prevLightboxIndex)
      toast.success('已恢复到列表')
      fetchList(true)
    } else {
      toast.error(data.msg || '恢复失败')
    }
  } catch {
    toast.error('恢复失败')
  }
}

const copyText = async (text: string, msg: string) => {
  if (await copyTextFallback(text)) {
    toast.success(msg)
  } else {
    toast.error('复制失败，请尝试手动选中复制')
  }
}

// 多选批量操作
const selectedIds = ref<Set<string>>(new Set())
const selectionVersion = ref(0) // Set 内部变更不触发响应式，用版本号驱动 computed 更新

const isSelected = (id: string) => selectedIds.value.has(id)

const toggleSelect = (id: string) => {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectionVersion.value++
}

// 相册式选择模式：checkbox 常显、点卡片即选中（预览走卡片右上角按钮 / 列表行缩略图）
const selectMode = ref(false)
const exitSelectMode = () => {
  selectMode.value = false
  shiftAnchorId.value = null // 保留已选项，用户可在浏览模式继续用批量菜单操作
}

// 全选（作用于当前筛选+排序后的完整列表，跨分页生效）
const allSelected = computed(() => {
  void selectionVersion.value
  return filteredList.value.length > 0 && filteredList.value.every((item) => selectedIds.value.has(item.id))
})

// 两档全选：仅本页 / 全部筛选结果（键盘 Ctrl/Cmd+A = 全部切换）
const selectPage = () => {
  for (const item of pagedList.value) selectedIds.value.add(item.id)
  selectionVersion.value++
}

const selectAllFiltered = () => {
  for (const item of filteredList.value) selectedIds.value.add(item.id)
  selectionVersion.value++
}

// Shift+点击范围选择：从上次点击项到本次点击项之间全部选中（桌面效率核心）
const shiftAnchorId = ref<string | null>(null)

const handleSelectClick = (item: ImageRecord, e: { shiftKey: boolean }) => {
  if (e.shiftKey && shiftAnchorId.value && shiftAnchorId.value !== item.id) {
    const ids = filteredList.value.map((r) => r.id)
    const a = ids.indexOf(shiftAnchorId.value)
    const b = ids.indexOf(item.id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) {
        const id = ids[i]
        if (id) selectedIds.value.add(id)
      }
      selectionVersion.value++
      return
    }
  }
  toggleSelect(item.id)
  shiftAnchorId.value = item.id
}

// 选择模式下缩略图点击 = 切换选中；浏览模式 = 打开大图预览
const onThumbClick = (item: ImageRecord, e: MouseEvent) => {
  if (selectMode.value) {
    handleSelectClick(item, e)
    return
  }
  lightboxItem.value = item
}

// 移动端长按卡片进入选择模式（相册习惯）；滚动位移超阈值视为滚动并取消
const LONG_PRESS_MS = 500
let pressTimer: number | null = null
let pressStart = { x: 0, y: 0 }
let longPressFired = false

const onThumbTouchStart = (item: ImageRecord, e: TouchEvent) => {
  if (selectMode.value) return
  const t = e.touches[0]
  if (!t) return
  pressStart = { x: t.clientX, y: t.clientY }
  longPressFired = false
  pressTimer = window.setTimeout(() => {
    pressTimer = null
    longPressFired = true
    selectMode.value = true
    toggleSelect(item.id)
    shiftAnchorId.value = item.id
    navigator.vibrate?.(15) // 触觉反馈，支持的设备生效
  }, LONG_PRESS_MS)
}

const onThumbTouchMove = (e: TouchEvent) => {
  if (!pressTimer) return
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - pressStart.x
  const dy = t.clientY - pressStart.y
  if (dx * dx + dy * dy > 12 * 12) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

const onThumbTouchEnd = (e: TouchEvent) => {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
    return
  }
  // 长按已触发：阻止合成 click（否则会立刻把刚选中的卡片又切换掉）
  if (longPressFired) {
    e.preventDefault()
    longPressFired = false
  }
}

onUnmounted(() => {
  if (pressTimer) clearTimeout(pressTimer)
})

// 读取 selectionVersion 驱动 computed 更新（Set 内部变更不触发响应式）
const selectedList = computed(() => {
  void selectionVersion.value
  return list.value.filter((item) => selectedIds.value.has(item.id))
})

const clearSelection = () => {
  selectedIds.value.clear()
  selectionVersion.value++
}

const copySelected = (key: 'url' | 'markdown' | 'html' | 'bbcode') => {
  const text = selectedList.value
    .map((item) => buildFormats(item, item.url).find((f) => f.key === key)?.value || '')
    .filter(Boolean)
    .join('\n')
  if (!text) return
  const label = { url: '链接', markdown: 'Markdown', html: 'HTML', bbcode: 'BBCode' }[key]
  copyText(text, `已复制 ${selectedList.value.length} 条${label}`)
}

// 批量删除：回收站 = 弹窗确认后彻底删除；正常列表 = 直接软删除（toast 可撤销）
const batchDeleting = ref(false)
const askBatchDelete = () => {
  if (selectedList.value.length === 0) return
  if (trashMode.value) {
    pendingBatchDelete.value = true
  } else {
    handleBatchDelete()
  }
}
const handleBatchDelete = async () => {
  if (batchDeleting.value || selectedList.value.length === 0) return
  batchDeleting.value = true
  const targets = [...selectedList.value]
  const lightboxWasOpen = !!lightboxItem.value && targets.some((t) => t.id === lightboxItem.value!.id)
  const prevLightboxIndex = lightboxIndex.value
  const purgeSuffix = trashMode.value ? '&purge=1' : ''
  try {
    const { data } = await axios.delete(`/image-records?${idsParams(targets)}${purgeSuffix}`, { baseURL: '' })
    if (data.code === 0) {
      const done = new Set(targets.map((i) => i.id))
      list.value = list.value.filter((row) => !done.has(row.id))
      clearSelection()
      snapLightboxAfterRemoval(lightboxWasOpen, prevLightboxIndex)
      fetchList(true)
      const ok = data.data?.ok ?? targets.length
      const fail = data.data?.fail ?? 0
      if (fail === 0 && trashMode.value) {
        // CNB 源文件删除已在服务端 purge 流程中联动执行（尽力而为）
        if ((data.data?.cnbFailed ?? 0) === 0) {
          toast.success(`已彻底删除 ${ok} 条记录（含 CNB 源文件）`)
        } else {
          toast.warning(`已删除 ${ok} 条记录；部分 CNB 源文件删除失败`)
        }
      } else if (fail === 0) {
        toast.success(`已删除 ${ok} 条记录`, {
          action: {
            label: '撤销',
            onClick: () => restoreRecords(targets, ok > 1 ? `已恢复 ${ok} 条记录` : '已恢复'),
          },
          duration: 6000,
        })
      } else {
        toast.warning(`${ok} 条删除成功，${fail} 条失败`)
      }
    } else {
      toast.error(data.msg || '删除失败')
    }
  } catch {
    toast.error('删除失败')
  } finally {
    batchDeleting.value = false
    pendingBatchDelete.value = false
  }
}

// 导出全部（或选中）记录为 JSON 文件
const exportRecords = (scope: 'all' | 'selected') => {
  const items = scope === 'selected' ? selectedList.value : filteredList.value
  if (items.length === 0) return
  const payload = items.map(({ id, name, url, thumbnailUrl, size, type, createdAt }) => ({
    id,
    name,
    url,
    thumbnailUrl,
    size,
    type,
    createdAt,
  }))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `imgbed-records-${new Date().toISOString().slice(0, 10)}.json`
  // Safari 要求 <a> 在文档内 click 才触发下载；revoke 延迟到下载开始后，避免竞态
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  toast.success(`已导出 ${items.length} 条记录`)
}

// 导入 JSON 备份：复用批量写接口（50 条/批，同 id 幂等覆盖），成功后刷新列表
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

const pickImportFile = () => importInput.value?.click()

const handleImportFile = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file || importing.value) return
  importing.value = true
  try {
    const parsed = JSON.parse(await file.text())
    if (!Array.isArray(parsed)) {
      toast.error('导入失败：备份文件需要是记录数组')
      return
    }
    const items = parsed.filter((r) => r && r.id && r.url && r.createdAt)
    if (items.length === 0) {
      toast.error('导入失败：备份文件中没有有效记录')
      return
    }
    let ok = 0
    for (let i = 0; i < items.length; i += 50) {
      const { data } = await axios.post('/image-records', { records: items.slice(i, i + 50) }, { baseURL: '' })
      if (data.code !== 0) {
        toast.error(data.msg || '导入失败')
        return
      }
      ok += data.data?.ok ?? Math.min(50, items.length - i)
    }
    toast.success(`已导入 ${ok} 条记录`)
    fetchList(true)
  } catch {
    toast.error('导入失败：无法读取 JSON 文件')
  } finally {
    importing.value = false
  }
}

// 复用 buildFormats，保证与上传结果卡的转义规则一致
const copyFormat = (item: ImageRecord, key: 'url' | 'markdown' | 'html' | 'bbcode') => {
  const fmt = buildFormats(item, item.url).find((f) => f.key === key)
  if (fmt) copyText(fmt.value, { url: '链接已复制', markdown: 'Markdown 已复制', html: 'HTML 已复制', bbcode: 'BBCode 已复制' }[key])
}

// 预览底部操作条的复制按钮（四种格式）
const lightboxCopyFormats: Array<{ key: 'url' | 'markdown' | 'html' | 'bbcode'; label: string; title: string; icon: Component }> = [
  { key: 'url', label: '直链', title: '复制直链 (F2)', icon: LinkIcon },
  { key: 'markdown', label: 'MD', title: '复制 Markdown', icon: Braces },
  { key: 'html', label: 'HTML', title: '复制 HTML', icon: Code2 },
  { key: 'bbcode', label: 'BBCode', title: '复制 BBCode', icon: Code2 },
]

// 快捷键帮助卡片
const showShortcuts = ref(false)

onMounted(async () => {
  if (globalStats.value && !stats.value) stats.value = globalStats.value
  await fetchList()
  // 上传成功但 KV 写记录失败的孤儿记录：静默补写，成功则刷新列表
  try {
    const flushed = await flushPendingRecords()
    if (flushed > 0) {
      toast.success(`已补写 ${flushed} 条之前保存失败的记录`)
      fetchList(true)
    }
  } catch {
    // 补写失败不打扰主流程（队列保留，下次再试）
  }
  window.addEventListener('keydown', onKeydown)
  // 「新」角标到期自动消失：每 30 秒刷新一次时间基准
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 30000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-4">
      <!-- 页头 -->
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">{{ trashMode ? '回收站' : '图片列表' }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ trashMode ? trashFootprintText : '管理和浏览您上传的所有图片' }}
          </p>
        </div>
      </div>

      <!-- 工具栏卡片：搜索 + 批量操作 + 导出 + 刷新 + 视图切换 -->
      <div class="card flex flex-col gap-3 p-3 sm:p-4">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3">
          <!-- 搜索框：文件名 / URL（/ 快捷聚焦，Esc 清空） -->
          <div class="relative min-w-0 flex-1 basis-48">
            <Search class="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref="searchInput"
              v-model="keyword"
              type="text"
              placeholder="搜索文件名、URL..."
              class="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-9 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 dark:focus:bg-gray-800"
            />
            <button
              v-if="keyword"
              @click="keyword = ''"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
              title="清空搜索"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <!-- 批量选择模式入口：选择模式下变为「完成」 -->
          <button
            v-if="!selectMode"
            @click="selectMode = true"
            class="flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            title="进入批量选择（移动端也可长按图片）"
          >
            <CheckSquare class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">批量选择</span>
          </button>
          <button
            v-else
            @click="exitSelectMode"
            class="flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition-colors hover:bg-indigo-500"
            title="退出批量选择（Esc）"
          >
            <Check class="h-3.5 w-3.5" />
            完成
          </button>
          <!-- 批量操作下拉 -->
          <div class="relative">
            <button
              @click="showBatchMenu = !showBatchMenu; showSortMenu = false; showTypeMenu = false; showSizeMenu = false"
              class="flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            >
              <SlidersHorizontal class="h-3.5 w-3.5" />
              <span class="hidden sm:inline">批量操作</span>
              <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="showBatchMenu ? 'rotate-180' : ''" />
            </button>
            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 -translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-y-0"
              leave-to-class="opacity-0 -translate-y-1"
            >
              <div
                v-if="showBatchMenu"
                class="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
              >
                <button
                  v-if="!trashMode"
                  @click="copySelected('url'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Copy class="h-3.5 w-3.5" /> 复制选中链接
                </button>
                <button
                  v-if="!trashMode"
                  @click="copySelected('markdown'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Braces class="h-3.5 w-3.5" /> 复制 Markdown
                </button>
                <button
                  v-if="!trashMode"
                  @click="copySelected('html'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Code2 class="h-3.5 w-3.5" /> 复制 HTML
                </button>
                <button
                  v-if="!trashMode"
                  @click="copySelected('bbcode'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Code2 class="h-3.5 w-3.5" /> 复制 BBCode
                </button>
                <button
                  @click="exportRecords(selectedList.length > 0 ? 'selected' : 'all'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Download class="h-3.5 w-3.5" /> {{ selectedList.length > 0 ? `导出选中(${selectedList.length})` : '导出 JSON' }}
                </button>
                <button
                  @click="pickImportFile(); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Upload class="h-3.5 w-3.5" /> 导入 JSON
                </button>
                <button
                  v-if="trashMode"
                  @click="restoreBatch(); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                >
                  <ArchiveRestore class="h-3.5 w-3.5" /> 恢复选中 ({{ selectedList.length }})
                </button>
                <button
                  @click="askBatchDelete(); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash2 class="h-3.5 w-3.5" /> {{ trashMode ? `彻底删除(${selectedList.length})` : `删除选中(${selectedList.length})` }}
                </button>
              </div>
            </Transition>
          </div>
          <button
            @click="exportRecords(selectedList.length > 0 ? 'selected' : 'all')"
            class="hidden h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 sm:flex dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            :title="selectedList.length > 0 ? '导出选中记录' : '导出当前筛选的全部记录'"
          >
            <Download class="h-3.5 w-3.5" />
            导出 JSON
          </button>
          <button
            @click="showShortcuts = !showShortcuts"
            class="hidden h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-500 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 md:flex dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            title="键盘快捷键"
          >
            <Keyboard class="h-3.5 w-3.5" />
            快捷键
          </button>
          <button
            @click="fetchList()"
            class="flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            title="刷新"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
            <span class="hidden sm:inline">刷新</span>
          </button>
          <!-- 网格 / 列表切换 + 网格密度 -->
          <div class="flex h-10 items-center gap-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <button
              @click="viewMode = 'grid'"
              class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              :class="viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              title="网格视图"
            >
              <LayoutGrid class="h-4 w-4" />
            </button>
            <button
              @click="viewMode = 'list'"
              class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              :class="viewMode === 'list' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              title="列表视图"
            >
              <List class="h-4 w-4" />
            </button>
            <button
              v-if="viewMode === 'grid'"
              @click="gridDensity = gridDensity === 'compact' ? 'comfortable' : 'compact'"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
              :title="gridDensity === 'compact' ? '切换为舒适密度' : '切换为紧凑密度'"
            >
              <Grid3x3 v-if="gridDensity === 'compact'" class="h-4 w-4" />
              <Grid2x2 v-else class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 筛选行：排序 / 类型 / 大小 / 时间（移动端收进筛选抽屉）+ 共 N 张 -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs dark:border-gray-800">
          <!-- 排序下拉 -->
          <div class="relative hidden items-center gap-1.5 sm:flex">
            <span class="text-gray-400 dark:text-gray-500">排序：</span>
            <button
              @click="showSortMenu = !showSortMenu; showBatchMenu = false; showTypeMenu = false; showSizeMenu = false; showTimeMenu = false"
              class="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
            >
              {{ sortLabel }}
              <ChevronDown class="h-3 w-3 transition-transform" :class="showSortMenu ? 'rotate-180' : ''" />
            </button>
            <div
              v-if="showSortMenu"
              class="absolute left-10 top-full z-30 mt-2 w-36 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                v-for="opt in sortOptions"
                :key="opt.key"
                @click="setSort(opt.key)"
                class="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium transition-colors"
                :class="sortKey === opt.key ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'"
              >
                {{ opt.label }}
                <ChevronUp v-if="sortKey === opt.key && sortDir === 'asc'" class="h-3 w-3" />
                <ChevronDown v-else-if="sortKey === opt.key" class="h-3 w-3" />
              </button>
            </div>
          </div>
          <!-- 类型下拉 -->
          <div class="relative hidden items-center gap-1.5 sm:flex">
            <span class="text-gray-400 dark:text-gray-500">类型：</span>
            <button
              @click="showTypeMenu = !showTypeMenu; showBatchMenu = false; showSortMenu = false; showSizeMenu = false; showTimeMenu = false"
              class="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {{ typeLabel }}
              <ChevronDown class="h-3 w-3 transition-transform" :class="showTypeMenu ? 'rotate-180' : ''" />
            </button>
            <div
              v-if="showTypeMenu"
              class="absolute left-10 top-full z-30 mt-2 w-32 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                @click="typeFilter = 'all'; showTypeMenu = false"
                class="block w-full px-4 py-2 text-left text-xs font-bold transition-colors"
                :class="typeFilter === 'all' ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'"
              >
                全部
              </button>
              <button
                v-for="t in availableTypes"
                :key="t"
                @click="typeFilter = t; showTypeMenu = false"
                class="block w-full px-4 py-2 text-left text-xs font-bold uppercase transition-colors"
                :class="typeFilter === t ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'"
              >
                {{ t }}
              </button>
            </div>
          </div>
          <!-- 大小下拉 -->
          <div class="relative hidden items-center gap-1.5 sm:flex">
            <span class="text-gray-400 dark:text-gray-500">大小：</span>
            <button
              @click="showSizeMenu = !showSizeMenu; showBatchMenu = false; showSortMenu = false; showTypeMenu = false; showTimeMenu = false"
              class="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {{ sizeLabel }}
              <ChevronDown class="h-3 w-3 transition-transform" :class="showSizeMenu ? 'rotate-180' : ''" />
            </button>
            <div
              v-if="showSizeMenu"
              class="absolute left-10 top-full z-30 mt-2 w-36 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                v-for="opt in sizeFilterOptions"
                :key="opt.value"
                @click="sizeFilter = opt.value; showSizeMenu = false"
                class="block w-full px-4 py-2 text-left text-xs font-bold transition-colors"
                :class="sizeFilter === opt.value ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <!-- 时间下拉 -->
          <div class="relative hidden items-center gap-1.5 sm:flex">
            <span class="text-gray-400 dark:text-gray-500">时间：</span>
            <button
              @click="showTimeMenu = !showTimeMenu; showBatchMenu = false; showSortMenu = false; showTypeMenu = false; showSizeMenu = false"
              class="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {{ timeLabel }}
              <ChevronDown class="h-3 w-3 transition-transform" :class="showTimeMenu ? 'rotate-180' : ''" />
            </button>
            <div
              v-if="showTimeMenu"
              class="absolute left-10 top-full z-30 mt-2 w-32 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                v-for="opt in timeFilterOptions"
                :key="opt.value"
                @click="timeFilter = opt.value; showTimeMenu = false"
                class="block w-full px-4 py-2 text-left text-xs font-bold transition-colors"
                :class="timeFilter === opt.value ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <!-- 移动端：筛选收纳入口 -->
          <button
            @click="openFilterSheet"
            class="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 font-semibold text-gray-600 transition-colors hover:bg-gray-200 sm:hidden dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <SlidersHorizontal class="h-3 w-3" />
            筛选<template v-if="activeFilterCount"> ({{ activeFilterCount }})</template>
          </button>
          <p class="ml-auto text-xs tabular-nums text-gray-400 dark:text-gray-500">
            共 {{ filteredList.length }} 张图片
          </p>
        </div>

        <!-- 筛选 Chip 行：生效条件一览，可单独移除 -->
        <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
          <button
            v-if="keyword"
            @click="keyword = ''"
            class="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
            title="移除搜索条件"
          >
            搜索: {{ keyword }}
            <X class="h-3 w-3" />
          </button>
          <button
            v-if="typeFilter !== 'all'"
            @click="typeFilter = 'all'"
            class="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
            title="移除类型条件"
          >
            类型: {{ typeFilter.toUpperCase() }}
            <X class="h-3 w-3" />
          </button>
          <button
            v-if="sizeFilter !== 'all'"
            @click="sizeFilter = 'all'"
            class="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
            title="移除大小条件"
          >
            大小: {{ sizeLabel }}
            <X class="h-3 w-3" />
          </button>
          <button
            v-if="timeFilter !== 'all'"
            @click="timeFilter = 'all'"
            class="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
            title="移除时间条件"
          >
            时间: {{ timeLabel }}
            <X class="h-3 w-3" />
          </button>
          <button
            @click="clearFilters"
            class="rounded-full px-2 py-1 text-[11px] font-semibold text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
          >
            清空筛选
          </button>
        </div>
      </div>

      <!-- 导入 JSON 备份的隐藏文件选择框（批量操作菜单触发） -->
      <input
        ref="importInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="handleImportFile"
      />

      <!-- 快捷键帮助 -->
      <div v-if="showShortcuts" class="card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">↑</kbd>/<kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">↓</kbd> 选择</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">X</kbd> 选中</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Enter</kbd> 预览</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">←</kbd>/<kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">→</kbd> 预览切换</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">F2</kbd> 复制链接</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Del</kbd> 删除</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">/</kbd> 搜索</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Ctrl+A</kbd> 全选</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Esc</kbd> 关闭弹层</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">?</kbd> 显示/隐藏本卡</span>
      </div>

      <!-- 批量操作工具栏：有选中项时出现 -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="selectMode || selectedList.length > 0"
          class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200/60 bg-indigo-50/70 px-5 py-3 max-md:fixed max-md:inset-x-3 max-md:bottom-[4.75rem] max-md:z-40 max-md:shadow-xl dark:border-indigo-500/20 dark:bg-indigo-900/20"
        >
          <p class="relative text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            已选 <span class="font-bold">{{ selectedList.length }}</span>{{ selectMode ? ` / ${filteredList.length} 张` : ' 项' }}
            <span v-if="selectMode" class="relative ml-2 inline-block">
              <button
                @click="showSelectMenu = !showSelectMenu"
                class="rounded-md bg-white px-2 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-100 dark:bg-gray-800 dark:text-indigo-300 dark:ring-indigo-500/30 dark:hover:bg-indigo-900/40"
              >
                全选
                <ChevronDown class="inline h-3 w-3 align-[-1px] transition-transform" :class="showSelectMenu ? 'rotate-180' : ''" />
              </button>
              <div
                v-if="showSelectMenu"
                class="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
              >
                <button
                  @click="selectPage(); showSelectMenu = false"
                  class="block w-full px-4 py-2 text-left text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  全选本页（{{ pagedList.length }}）
                </button>
                <button
                  @click="selectAllFiltered(); showSelectMenu = false"
                  class="block w-full px-4 py-2 text-left text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  全选全部（{{ filteredList.length }}）
                </button>
                <button
                  v-if="selectedList.length > 0"
                  @click="clearSelection(); showSelectMenu = false"
                  class="block w-full px-4 py-2 text-left text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  取消全选
                </button>
              </div>
            </span>
            <button
              v-else
              @click="clearSelection"
              class="ml-2 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
            >
              取消选择
            </button>
          </p>
          <div v-if="selectedList.length > 0" class="flex flex-wrap items-center gap-2">
            <template v-if="!trashMode">
              <button
                @click="copySelected('url')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
              >
                <Copy class="h-3.5 w-3.5" />
                复制选中链接
              </button>
              <button
                @click="copySelected('markdown')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
              >
                <Braces class="h-3.5 w-3.5" />
                复制 Markdown
              </button>
              <button
                @click="copySelected('html')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
              >
                <Code2 class="h-3.5 w-3.5" />
                复制 HTML
              </button>
              <button
                @click="copySelected('bbcode')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
              >
                <Code2 class="h-3.5 w-3.5" />
                BBCode
              </button>
            </template>
            <button
              v-if="trashMode"
              @click="restoreBatch"
              class="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-600"
            >
              <ArchiveRestore class="h-3.5 w-3.5" />
              恢复选中 ({{ selectedList.length }})
            </button>
            <button
              @click="askBatchDelete"
              :disabled="batchDeleting"
              class="flex h-8 items-center gap-1.5 rounded-lg bg-red-500 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 class="h-3.5 w-3.5" />
              {{ trashMode ? '彻底删除' : '删除选中' }} ({{ selectedList.length }})
            </button>
          </div>
        </div>
      </Transition>



      <!-- ========== 网格视图（默认，与目标图一致） ========== -->
      <template v-if="viewMode === 'grid'">
        <div v-if="loading" :class="gridClass">
          <div v-for="i in 8" :key="i" class="card overflow-hidden">
            <div class="aspect-[4/3] animate-pulse bg-gray-200/70 dark:bg-gray-700/40" />
            <div class="space-y-2 p-3">
              <div class="h-3.5 w-2/3 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/40" />
              <div class="h-3 w-1/2 animate-pulse rounded-full bg-gray-200/50 dark:bg-gray-700/30" />
            </div>
          </div>
        </div>

        <div v-else-if="filteredList.length === 0" class="card flex flex-col items-center justify-center gap-2 p-16 text-center sm:p-20">
          <FileImage class="h-14 w-14 text-gray-300 opacity-60 dark:text-gray-600" />
          <p class="text-base font-semibold text-gray-500 dark:text-gray-400">{{ hasActiveFilters ? '没有匹配的图片' : trashMode ? '回收站是空的' : '暂无上传记录' }}</p>
          <p v-if="hasActiveFilters" class="text-xs text-gray-400 dark:text-gray-500">换个条件试试</p>
          <button
            v-if="hasActiveFilters"
            @click="clearFilters"
            class="mt-3 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
          >
            清除筛选
          </button>
          <RouterLink
            v-if="!hasActiveFilters && !trashMode"
            to="/"
            class="brand-gradient mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            去上传第一张图
          </RouterLink>
        </div>

        <div v-else :class="gridClass">
          <div
            v-for="(item, idx) in pagedList"
            :key="item.id"
            class="card group overflow-hidden transition-all"
            :class="[
              isSelected(item.id) ? 'ring-2 ring-indigo-500 dark:ring-indigo-400' : 'hover:shadow-lg',
              focusIndex === ((page - 1) * pageSize + idx) ? 'ring-2 ring-indigo-400/60' : '',
            ]"
          >
            <!-- 缩略图区：hover 露出 checkbox + … 菜单；左下格式 badge；右下快捷复制 -->
              <div class="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-800">
                <button
                  @click="onThumbClick(item, $event)"
                  @touchstart="onThumbTouchStart(item, $event)"
                  @touchmove="onThumbTouchMove"
                  @touchend="onThumbTouchEnd"
                  @contextmenu.prevent
                  class="block h-full w-full"
                  :class="selectMode ? 'cursor-pointer' : 'cursor-zoom-in'"
                  :title="selectMode ? '点击选择' : '点击查看大图'"
                >
                  <img
                    :src="item.thumbnailUrl || item.url"
                    :alt="item.name"
                    :width="item.width"
                    :height="item.height"
                    loading="lazy"
                    decoding="async"
                    class="h-full w-full select-none object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </button>
                <!-- 左上：多选指示器（浏览模式 hover 露出的 checkbox / 选择模式常显指示器） -->
                <label
                  v-if="!selectMode"
                  class="absolute left-2.5 top-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow-sm backdrop-blur transition-opacity dark:bg-gray-900/80"
                  :class="isSelected(item.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'"
                  @click.stop
                >
                  <input
                    type="checkbox"
                    :checked="isSelected(item.id)"
                    @change="toggleSelect(item.id)"
                    class="h-4 w-4 cursor-pointer accent-indigo-600"
                    title="选择此项"
                  />
                </label>
                <div
                  v-else
                  class="absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg shadow-sm backdrop-blur transition-all"
                  :class="isSelected(item.id) ? 'bg-indigo-600 text-white' : 'border-2 border-white/90 bg-white/70 dark:border-gray-300/70 dark:bg-gray-900/50'"
                >
                  <Check v-if="isSelected(item.id)" class="h-4 w-4" />
                </div>
                <!-- 右上：选择模式为预览按钮；浏览模式为 … 更多菜单 -->
                <div class="absolute right-2.5 top-2.5">
                  <button
                    v-if="selectMode"
                    @click.stop="lightboxItem = item"
                    class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-gray-500 shadow-sm backdrop-blur transition-all hover:text-gray-800 dark:bg-gray-900/80 dark:text-gray-400 dark:hover:text-gray-100"
                    title="预览大图"
                  >
                    <ZoomIn class="h-4 w-4" />
                  </button>
                  <template v-else>
                    <button
                    @click.stop="openMenuId = openMenuId === item.id ? null : item.id"
                    class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-gray-500 shadow-sm backdrop-blur transition-all hover:text-gray-800 dark:bg-gray-900/80 dark:text-gray-400 dark:hover:text-gray-100"
                    :class="openMenuId === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                    title="更多操作"
                  >
                    <MoreHorizontal class="h-4 w-4" />
                  </button>
                <Transition
                  enter-active-class="transition duration-150 ease-out"
                  enter-from-class="opacity-0 -translate-y-1"
                  enter-to-class="opacity-100 translate-y-0"
                  leave-active-class="transition duration-100 ease-in"
                  leave-from-class="opacity-100 translate-y-0"
                  leave-to-class="opacity-0 -translate-y-1"
                >
                  <div
                    v-if="openMenuId === item.id"
                    class="absolute right-0 z-30 mt-1.5 w-40 overflow-hidden rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
                    @click.stop
                  >
                    <button
                      v-if="!trashMode"
                      @click="copyFormat(item, 'url'); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                    >
                      <Copy class="h-3.5 w-3.5" /> 复制链接
                    </button>
                    <button
                      v-if="!trashMode"
                      @click="copyFormat(item, 'markdown'); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                    >
                      <Braces class="h-3.5 w-3.5" /> Markdown
                    </button>
                    <button
                      v-if="!trashMode"
                      @click="copyFormat(item, 'html'); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                    >
                      <Code2 class="h-3.5 w-3.5" /> HTML
                    </button>
                    <button
                      v-if="!trashMode"
                      @click="copyFormat(item, 'bbcode'); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                    >
                      <Code2 class="h-3.5 w-3.5" /> BBCode
                    </button>
                    <button
                      v-if="trashMode"
                      @click="restoreItem(item); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                    >
                      <ArchiveRestore class="h-3.5 w-3.5" /> 恢复
                    </button>
                    <button
                      @click="trashMode ? (pendingDelete = item) : softDelete(item); closeMenus()"
                      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Trash2 class="h-3.5 w-3.5" /> {{ trashMode ? '彻底删除' : '移入回收站' }}
                    </button>
                  </div>
                </Transition>
                  </template>
              </div>
              <!-- 左下：格式 badge -->
              <span class="absolute bottom-2.5 left-2.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                {{ (item.type || '').split('/')[1] || 'img' }}
              </span>
              <!-- 右下：快捷复制链接 -->
              <button
                v-if="!trashMode"
                @click.stop="copyFormat(item, 'url')"
                title="复制链接"
                class="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-gray-500 opacity-0 shadow-sm backdrop-blur transition-all hover:text-indigo-600 group-hover:opacity-100 dark:bg-gray-900/80 dark:text-gray-400 dark:hover:text-indigo-300"
              >
                <LinkIcon class="h-3.5 w-3.5" />
              </button>
              <button
                v-else
                @click.stop="restoreItem(item)"
                title="恢复"
                class="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-gray-500 opacity-0 shadow-sm backdrop-blur transition-all hover:text-emerald-600 group-hover:opacity-100 dark:bg-gray-900/80 dark:text-gray-400 dark:hover:text-emerald-400"
              >
                <ArchiveRestore class="h-3.5 w-3.5" />
              </button>
            </div>
            <!-- 信息区：文件名 + 大小/时间 + 底部四操作 -->
            <div class="p-3">
              <p class="truncate text-xs font-semibold text-gray-800 sm:text-sm dark:text-gray-100" :title="item.name">
                <span v-if="!trashMode && isNewRecord(item)" class="mr-1 inline-block rounded bg-indigo-500 px-1 align-middle text-[9px] font-bold leading-4 text-white">新</span><template v-for="(seg, i) in highlightName(item.name)" :key="i"><mark v-if="seg.hit" class="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
              </p>
              <p class="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{{ formatSize(item.size) }}</span>
                <span>{{ formatDate(item.createdAt) }}</span>
                <span
                  v-if="trashMode && item.deletedAt"
                  class="rounded-full px-1.5 py-0.5 font-semibold"
                  :class="daysLeftClass(item.deletedAt)"
                >剩 {{ daysLeft(item.deletedAt) }} 天</span>
              </p>
              <div class="mt-2 flex items-center gap-0.5 border-t border-gray-100 pt-2 dark:border-gray-800">
                <button
                  v-if="!trashMode"
                  @click="copyFormat(item, 'url')"
                  title="复制链接"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                >
                  <LinkIcon class="h-4 w-4" />
                </button>
                <button
                  v-if="!trashMode"
                  @click="copyFormat(item, 'markdown')"
                  title="复制 Markdown"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                >
                  <Copy class="h-4 w-4" />
                </button>
                <button
                  v-if="!trashMode"
                  @click="copyFormat(item, 'html')"
                  title="复制 HTML"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                >
                  <Braces class="h-4 w-4" />
                </button>
                <button
                  v-if="trashMode"
                  @click="restoreItem(item)"
                  title="恢复"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
                >
                  <ArchiveRestore class="h-4 w-4" />
                </button>
                <button
                  @click="trashMode ? (pendingDelete = item) : softDelete(item)"
                  :title="trashMode ? '彻底删除' : '移入回收站'"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 网格分页 -->
        <PaginationBar
          v-if="!loading && filteredList.length > 0"
          v-model:page="page"
          :total-pages="totalPages"
          :total="filteredList.length"
        />
      </template>

      <!-- ========== 列表视图（原有行布局，保留键盘导航/复选框/分页） ========== -->
      <template v-else>
      <div class="card overflow-hidden">
        <div v-if="loading" class="space-y-4 p-6">
          <!-- 骨架屏：模拟真实行高，加载完不跳动 -->
          <div v-for="i in 8" :key="i" class="flex items-center gap-4">
            <div class="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-gray-200/70 dark:bg-gray-700/50"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3.5 w-1/3 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/50"></div>
              <div class="h-3 w-1/4 animate-pulse rounded-full bg-gray-200/50 dark:bg-gray-700/30"></div>
            </div>
            <div class="hidden h-3 w-16 animate-pulse rounded-full bg-gray-200/50 sm:block dark:bg-gray-700/30"></div>
            <div class="hidden h-3 w-28 animate-pulse rounded-full bg-gray-200/50 md:block dark:bg-gray-700/30"></div>
          </div>
        </div>

        <div v-else-if="filteredList.length === 0" class="flex flex-col items-center justify-center p-20 text-gray-400 dark:text-gray-600">
          <FileImage class="mb-4 h-16 w-16 opacity-20" />
          <p class="text-lg font-medium">{{ hasActiveFilters ? '没有匹配的图片' : trashMode ? '回收站是空的' : '暂无上传记录' }}</p>
          <p v-if="hasActiveFilters" class="mt-1 text-sm">换个条件试试</p>
          <button
            v-if="hasActiveFilters"
            @click="clearFilters"
            class="mt-4 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
          >
            清除筛选
          </button>
          <RouterLink
            v-if="!hasActiveFilters && !trashMode"
            to="/"
            class="mt-5 brand-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            去上传第一张图
          </RouterLink>
        </div>

        <template v-else>
          <!-- 单列表自适应布局：桌面/移动端同一结构，窄屏自动隐藏次要信息，保证不出现横向滚动 -->
          <div class="divide-y divide-gray-100/50 dark:divide-gray-800/50">
            <div
              v-for="(item, idx) in pagedList"
              :key="item.id"
              class="flex items-center gap-3 px-3 py-3 transition-colors sm:px-5"
              :class="[
                isSelected(item.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : 'hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10',
                focusIndex === ((page - 1) * pageSize + idx) ? 'ring-1 ring-inset ring-indigo-400/60' : '',
              ]"
            >
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                @click.prevent="handleSelectClick(item, $event)"
                class="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
                title="选择此项（按住 Shift 点击可范围选择）"
              />
              <!-- 缩略图：选择模式下点击=选中（支持 Shift 范围），浏览模式查看大图 -->
              <button
                @click="onThumbClick(item, $event)"
                @touchstart="onThumbTouchStart(item, $event)"
                @touchmove="onThumbTouchMove"
                @touchend="onThumbTouchEnd"
                @contextmenu.prevent
                class="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                :class="selectMode ? 'cursor-pointer' : 'cursor-zoom-in'"
                :title="selectMode ? '点击选择' : '点击查看大图'"
              >
                <img
                  :src="item.thumbnailUrl || item.url"
                  :width="item.width"
                  :height="item.height"
                  class="h-full w-full select-none rounded-lg object-cover"
                  alt="preview"
                  loading="lazy"
                  decoding="async"
                />
              </button>

              <!-- 文件名 + 链接（弹性主列，最小宽度 0 才能正确截断） -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100" :title="item.name">
                  <span v-if="!trashMode && isNewRecord(item)" class="mr-1 inline-block rounded bg-indigo-500 px-1 align-middle text-[9px] font-bold leading-4 text-white">新</span><template v-for="(seg, i) in highlightName(item.name)" :key="i"><mark v-if="seg.hit" class="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
                </p>
                <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <a :href="item.url" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center gap-0.5 text-indigo-600 hover:underline dark:text-indigo-400">
                    查看原图 <ExternalLink class="h-3 w-3" />
                  </a>
                  <span class="whitespace-nowrap tabular-nums">{{ formatSize(item.size) }}</span>
                  <!-- 中屏起显示尺寸与格式 -->
                  <span v-if="item.width" class="hidden whitespace-nowrap tabular-nums lg:inline">{{ item.width }}×{{ item.height }}</span>
                  <span class="hidden rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 md:inline dark:bg-gray-800 dark:text-gray-400">
                    {{ (item.type || '').split('/')[1] }}
                  </span>
                  <!-- 大屏显示时间 -->
                  <span class="hidden whitespace-nowrap tabular-nums xl:inline">{{ formatDate(item.createdAt) }}</span>
                  <!-- 回收站：剩余保留天数 -->
                  <span
                    v-if="trashMode && item.deletedAt"
                    class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    :class="daysLeftClass(item.deletedAt)"
                  >剩 {{ daysLeft(item.deletedAt) }} 天</span>
                </div>
              </div>

              <!-- 时间（中屏辅助列） -->
              <span class="hidden shrink-0 whitespace-nowrap tabular-nums text-xs text-gray-400 md:block xl:hidden dark:text-gray-500">
                {{ formatDate(item.createdAt) }}
              </span>

              <!-- 操作按钮：始终完整显示，不挤压 -->
              <div class="flex shrink-0 items-center">
                <button
                  v-if="!trashMode"
                  @click="copyFormat(item, 'url')"
                  class="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition dark:text-gray-500 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
                  title="复制链接"
                >
                  <Copy class="h-4 w-4" />
                </button>
                <button
                  v-if="!trashMode"
                  @click="copyFormat(item, 'markdown')"
                  class="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition dark:text-gray-500 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
                  title="复制 Markdown"
                >
                  <Braces class="h-4 w-4" />
                </button>
                <button
                  v-if="trashMode"
                  @click="restoreItem(item)"
                  class="rounded-lg p-2 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition dark:text-gray-500 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
                  title="恢复"
                >
                  <ArchiveRestore class="h-4 w-4" />
                </button>
                <button
                  @click="trashMode ? (pendingDelete = item) : softDelete(item)"
                  class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  :title="trashMode ? '彻底删除' : '移入回收站'"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- 分页 -->
          <PaginationBar
            v-if="!loading && filteredList.length > 0"
            v-model:page="page"
            :total-pages="totalPages"
            :total="filteredList.length"
            class="border-t border-gray-100/50 px-4 py-3 dark:border-gray-800/50"
          />
        </template>
      </div>
      </template>

      <!-- 点任意空白关闭下拉 / 卡片菜单：菜单本身 stop 冒泡，只有遮罩能关 -->
      <div
        v-if="showBatchMenu || showSortMenu || showTypeMenu || showSizeMenu || showTimeMenu || showSelectMenu || openMenuId"
        class="fixed inset-0 z-20 cursor-default"
        @click="closeMenus"
      />

      <div class="mt-2 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm text-indigo-700 dark:border-indigo-900/30 dark:bg-indigo-900/10 dark:text-indigo-300">
        <AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
        <p>
          {{ trashMode
            ? '回收站中的记录保留 30 天后自动清除；「彻底删除」会同步删除 CNB 上的原图文件（个别删除失败时仅移除记录，可用设置页「孤儿文件扫描」兜底清理）。'
            : '删除会移入回收站（保留 30 天，可随时恢复）；在回收站彻底删除时才同步删除 CNB 上的原图文件。' }}
        </p>
      </div>
    </div>
  </AppShell>

  <!-- 弹层统一 Teleport 到 body：祖先的 backdrop-filter 会劫持 fixed 定位 -->
  <Teleport to="body">
    <!-- 大图预览：操作中心（←/→ 在当前筛选内切换 + 快捷复制 + 删除/恢复） -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="lightboxItem" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-gray-900/70 backdrop-blur-sm" @click="lightboxItem = null"></div>
        <div class="relative flex max-h-full max-w-full flex-col items-center">
          <!-- 顶行：位置指示 + 文件名 + 关闭 -->
          <div class="mb-2 flex w-full items-center gap-3 text-xs font-semibold text-white/80">
            <span class="shrink-0 tabular-nums">{{ lightboxIndex >= 0 ? lightboxIndex + 1 : '—' }} / {{ filteredList.length }}</span>
            <span class="min-w-0 flex-1 truncate" :title="lightboxItem.name">{{ lightboxItem.name }}</span>
            <button
              @click="lightboxItem = null"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              title="关闭预览 (Esc)"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="relative">
            <img
              :key="lightboxItem.id"
              :src="lightboxItem.url"
              :alt="lightboxItem.name"
              class="max-h-[62vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
            />
            <template v-if="filteredList.length > 1">
              <button
                @click.stop="lightboxStep(-1)"
                class="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
                title="上一张 (←)"
              >
                <ChevronLeft class="h-5 w-5" />
              </button>
              <button
                @click.stop="lightboxStep(1)"
                class="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
                title="下一张 (→)"
              >
                <ChevronRight class="h-5 w-5" />
              </button>
            </template>
          </div>
          <!-- 元信息 -->
          <p class="mt-2 text-[11px] tabular-nums text-white/60">
            <template v-if="lightboxItem.width">{{ lightboxItem.width }}×{{ lightboxItem.height }} · </template>{{ formatSize(lightboxItem.size) }} · {{ formatDate(lightboxItem.createdAt) }}
          </p>
          <!-- 操作条 -->
          <div class="mt-3 flex max-w-full flex-wrap items-center justify-center gap-2">
            <button
              v-for="fmt in lightboxCopyFormats"
              :key="fmt.key"
              @click="copyFormat(lightboxItem, fmt.key)"
              :title="fmt.title"
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              <component :is="fmt.icon" class="h-3.5 w-3.5" />{{ fmt.label }}
            </button>
            <a
              :href="lightboxItem.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              原图 <ExternalLink class="h-3 w-3" />
            </a>
            <button
              v-if="trashMode"
              @click="restoreItem(lightboxItem)"
              :disabled="deleting"
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500/90 px-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArchiveRestore class="h-3.5 w-3.5" /> 恢复
            </button>
            <button
              @click="deleteFromLightbox(lightboxItem)"
              :disabled="deleting"
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-red-500/90 px-2.5 text-xs font-bold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 class="h-3.5 w-3.5" /> {{ trashMode ? '彻底删除' : '移入回收站' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

  </Teleport>

  <!-- 删除确认弹窗（回收站彻底删除专用；正常列表软删除免确认、toast 可撤销） -->
  <ConfirmDialog
    :open="showDeleteDialog"
    :title="pendingBatchDelete ? `彻底删除这 ${selectedList.length} 条记录？` : '彻底删除这条记录？'"
    description="将从 KV 中彻底移除记录，并同步删除 CNB 上的原图文件，此操作不可恢复。"
    confirm-text="彻底删除"
    :loading="deleting"
    @confirm="pendingBatchDelete ? handleBatchDelete() : pendingDelete && handleDelete(pendingDelete)"
    @cancel="closeDeleteDialog"
  >
    <div
      v-if="pendingBatchDelete"
      class="w-full rounded-xl bg-gray-100/80 px-3.5 py-2.5 text-left dark:bg-gray-800/60"
    >
      <p
        v-for="item in selectedList.slice(0, 3)"
        :key="item.id"
        class="truncate font-mono text-xs leading-relaxed text-gray-600 dark:text-gray-300"
        :title="item.name"
      >{{ item.name }}</p>
      <p v-if="selectedList.length > 3" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
        …等共 {{ selectedList.length }} 条
      </p>
    </div>
    <p
      v-else
      class="w-full break-all rounded-xl bg-gray-100/80 px-3.5 py-2.5 text-left font-mono text-xs leading-relaxed text-gray-600 line-clamp-2 dark:bg-gray-800/60 dark:text-gray-300"
      :title="pendingDelete?.name"
    >{{ pendingDelete?.name }}</p>
  </ConfirmDialog>

  <!-- 移动端筛选抽屉（<640px）：排序 / 类型 / 大小 / 时间收纳为底部弹层 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="showFilterSheet" class="fixed inset-0 z-50 sm:hidden">
        <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" @click="showFilterSheet = false"></div>
        <div
          class="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-gray-100 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
          style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))"
        >
          <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
          <div class="flex flex-col gap-4">
            <div>
              <p class="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">排序</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.key"
                  @click="setSort(opt.key)"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                  :class="sortKey === opt.key ? 'brand-gradient text-white shadow-md shadow-indigo-500/25' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
                >
                  {{ opt.label }}{{ sortKey === opt.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}
                </button>
              </div>
            </div>
            <div>
              <p class="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">类型</p>
              <div class="flex flex-wrap gap-2">
                <button
                  @click="typeFilter = 'all'"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                  :class="typeFilter === 'all' ? 'brand-gradient text-white shadow-md shadow-indigo-500/25' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
                >
                  全部
                </button>
                <button
                  v-for="t in availableTypes"
                  :key="t"
                  @click="typeFilter = t"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold uppercase transition-all"
                  :class="typeFilter === t ? 'brand-gradient text-white shadow-md shadow-indigo-500/25' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
                >
                  {{ t }}
                </button>
              </div>
            </div>
            <div>
              <p class="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">大小</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in sizeFilterOptions"
                  :key="opt.value"
                  @click="sizeFilter = opt.value"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                  :class="sizeFilter === opt.value ? 'brand-gradient text-white shadow-md shadow-indigo-500/25' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <div>
              <p class="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">时间</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in timeFilterOptions"
                  :key="opt.value"
                  @click="timeFilter = opt.value"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                  :class="timeFilter === opt.value ? 'brand-gradient text-white shadow-md shadow-indigo-500/25' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="mt-5 flex gap-2">
            <button
              @click="clearFilters"
              class="h-10 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              清空筛选
            </button>
            <button
              @click="showFilterSheet = false"
              class="brand-gradient h-10 flex-1 rounded-xl text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:brightness-110"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
