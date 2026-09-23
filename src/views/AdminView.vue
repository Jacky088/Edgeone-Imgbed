<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
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
  Loader2,
  ArchiveRestore,
  Download,
  Keyboard,
  LayoutGrid,
  List,
  RefreshCw,
  SlidersHorizontal,
  MoreHorizontal,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { buildFormats } from '@/utils/formatLinks'
import { copyTextFallback } from '@/utils/clipboard'
import { useUploadSettings } from '@/composables/useUploadSettings'
import { flushPendingRecords } from '@/utils/pendingRecords'
import AppShell from '@/components/layout/AppShell.vue'

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
    router.replace({ path: '/admin', query: val ? { view: 'trash' } : {} })
  },
})
const stats = ref<{ count: number; totalSize: number; trashed: number } | null>(null)

// 前端搜索 + 类型筛选 + 大小筛选 + 排序 + 分页（数据已整表拉取，不再额外请求）
const keyword = ref('')
const typeFilter = ref('all')
type SizeFilter = 'all' | 'small' | 'medium' | 'large'
const sizeFilter = ref<SizeFilter>('all')
const sizeFilterOptions: Array<{ value: SizeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'small', label: '< 100KB' },
  { value: 'medium', label: '100KB–1MB' },
  { value: 'large', label: '> 1MB' },
]
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

// 顶部「批量操作」下拉与卡片「…」菜单（同一时间只开一个；点遮罩关闭）
const showBatchMenu = ref(false)
const openMenuId = ref<string | null>(null)
const closeMenus = () => {
  showBatchMenu.value = false
  showSortMenu.value = false
  showTypeMenu.value = false
  showSizeMenu.value = false
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

watch([keyword, typeFilter, sizeFilter], () => {
  page.value = 1
})
// 从导航切换回收站/正常列表时重置分页并重新拉取
watch(trashMode, () => {
  page.value = 1
  clearSelection()
  focusIndex.value = -1
  fetchList()
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

// 列表与统计一次请求拿全（KV 侧单次全表扫描 + ?stats=1 顺带统计）；quiet 静默刷新，不闪骨架屏
const fetchList = async (quiet = false) => {
  if (!quiet) loading.value = true
  try {
    const { data } = await axios.get('/image-records', {
      baseURL: '',
      params: { ...(trashMode.value ? { trash: 1 } : {}), stats: 1 },
    })
    if (data.code === 0) {
      // 兼容旧形状：纯数组（无统计）；新形状：{ records, stats }
      if (Array.isArray(data.data)) {
        list.value = data.data
      } else {
        list.value = data.data.records ?? []
        stats.value = data.data.stats ?? null
      }
    }
  } catch (e) {
    if (!quiet) toast.error('获取列表失败')
  } finally {
    if (!quiet) loading.value = false
  }
}

// 应用内删除确认（替代原生 confirm）：单条 / 批量共用一个弹窗
const pendingDelete = ref<ImageRecord | null>(null)
const pendingBatchDelete = ref(false)
const deleting = ref(false)
const cancelBtn = ref<HTMLButtonElement | null>(null)

const showDeleteDialog = computed(() => !!pendingDelete.value || pendingBatchDelete.value)

// 打开弹窗时把焦点放到「取消」上：手滑按回车也不会误删
watch(showDeleteDialog, async (open) => {
  if (!open) return
  deleting.value = false
  await nextTick()
  cancelBtn.value?.focus()
})

const closeDeleteDialog = () => {
  if (deleting.value) return
  pendingDelete.value = null
  pendingBatchDelete.value = false
}

// 缩略图点击后的大图预览
const lightboxItem = ref<ImageRecord | null>(null)

// 键盘导航：上下移动高亮，Enter 预览，Delete 删除
const focusIndex = ref(-1)

const moveFocus = (delta: number) => {
  if (filteredList.value.length === 0) return
  focusIndex.value = Math.min(
    filteredList.value.length - 1,
    Math.max(0, focusIndex.value < 0 ? 0 : focusIndex.value + delta),
  )
}

const focusedItem = computed(() =>
  focusIndex.value >= 0 ? filteredList.value[focusIndex.value] ?? null : null,
)

// Escape 关闭弹层（lightbox 优先于删除确认；删除请求进行中不响应）
const onKeydown = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement
  // 输入框里不劫持按键
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

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
  if (e.key === '?' && !showDeleteDialog.value && !lightboxItem.value) {
    showShortcuts.value = !showShortcuts.value
    return
  }
  if (e.key === 'F2' && focusedItem.value && !trashMode.value) {
    e.preventDefault()
    copyFormat(focusedItem.value, 'url')
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && focusedItem.value && !deleting.value) {
    e.preventDefault()
    if (trashMode.value) {
      pendingDelete.value = focusedItem.value
      pendingBatchDelete.value = false
    } else {
      // 正常列表默认软删除
      softDelete(focusedItem.value)
    }
    return
  }
  if (e.key !== 'Escape' || deleting.value) return
  if (lightboxItem.value) {
    lightboxItem.value = null
  } else if (showShortcuts.value) {
    showShortcuts.value = false
  } else {
    closeDeleteDialog()
  }
}

// 单条删除：正常列表软删除进回收站，回收站里彻底删除
const softDelete = async (item: ImageRecord) => {
  if (deleting.value) return
  deleting.value = true
  try {
    const { data } = await axios.delete('/image-records', {
      baseURL: '',
      params: trashMode.value ? { id: item.id, purge: 1 } : { id: item.id },
    })
    if (data.code === 0) {
      list.value = list.value.filter((row) => row.id !== item.id)
      toast.success(trashMode.value ? '已彻底删除' : '已移入回收站，30 天内可恢复')
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

const restoreBatch = async () => {
  const items = [...selectedList.value]
  if (items.length === 0) return
  try {
    const { data } = await axios.put(`/image-records?${idsParams(items)}`, {}, { baseURL: '' })
    if (data.code === 0) {
      const done = new Set(items.map((i) => i.id))
      list.value = list.value.filter((row) => !done.has(row.id))
      clearSelection()
      fetchList(true)
      toast.success(items.length > 1 ? `已恢复 ${items.length} 条记录` : '已恢复到列表')
    } else {
      toast.error(data.msg || '恢复失败')
    }
  } catch {
    toast.error('恢复失败')
  }
}

// 查询串组装 ?id=a&id=b（与 KV 侧 getAll('id') 批量路径配套）
const idsParams = (items: ImageRecord[]) => items.map((i) => `id=${encodeURIComponent(i.id)}`).join('&')

const restoreOne = async (item: ImageRecord): Promise<boolean> => {
  try {
    const { data } = await axios.put('/image-records', {}, { baseURL: '', params: { id: item.id } })
    if (data.code === 0) {
      list.value = list.value.filter((row) => row.id !== item.id)
      return true
    }
  } catch {
    // 计入失败
  }
  return false
}

const restoreItem = async (item: ImageRecord) => {
  const ok = await restoreOne(item)
  if (ok) {
    toast.success('已恢复到列表')
    fetchList(true)
  } else {
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

// 网格视图的多选入口是卡片 checkbox + 顶部批量下拉，此处保留底层选中态即可

const selectedList = computed(() => {
  selectionVersion.value
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

// 批量删除：弹窗确认后逐条调用现有接口，全部完成后统一提示
const batchDeleting = ref(false)
const askBatchDelete = () => {
  if (selectedList.value.length === 0) return
  pendingBatchDelete.value = true
}
const handleBatchDelete = async () => {
  if (batchDeleting.value || selectedList.value.length === 0) return
  batchDeleting.value = true
  const snapshot = [...selectedList.value]
  const purgeSuffix = trashMode.value ? '&purge=1' : ''
  try {
    const { data } = await axios.delete(`/image-records?${idsParams(snapshot)}${purgeSuffix}`, { baseURL: '' })
    if (data.code === 0) {
      const done = new Set(snapshot.map((i) => i.id))
      list.value = list.value.filter((row) => !done.has(row.id))
      clearSelection()
      fetchList(true)
      const ok = data.data?.ok ?? snapshot.length
      const fail = data.data?.fail ?? 0
      if (fail === 0) {
        toast.success(trashMode.value ? `已彻底删除 ${ok} 条记录` : `已删除 ${ok} 条记录`)
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

// 复用 buildFormats，保证与上传结果卡的转义规则一致
const copyFormat = (item: ImageRecord, key: 'url' | 'markdown' | 'html' | 'bbcode') => {
  const fmt = buildFormats(item, item.url).find((f) => f.key === key)
  if (fmt) copyText(fmt.value, { url: '链接已复制', markdown: 'Markdown 已复制', html: 'HTML 已复制', bbcode: 'BBCode 已复制' }[key])
}

// 快捷键帮助卡片
const showShortcuts = ref(false)

onMounted(async () => {
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
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <AppShell :stats="stats">
    <div class="flex flex-col gap-4">
      <!-- 页头 -->
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">{{ trashMode ? '回收站' : '图片列表' }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ trashMode ? '30 天后自动清除，可在此恢复' : '管理和浏览您上传的所有图片' }}
          </p>
        </div>
      </div>

      <!-- 工具栏卡片：搜索 + 批量操作 + 导出 + 刷新 + 视图切换 -->
      <div class="card flex flex-col gap-3 p-3 sm:p-4">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3">
          <!-- 搜索框：文件名 / URL -->
          <div class="relative min-w-0 flex-1 basis-48">
            <Search class="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索文件名、URL、标签..."
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
                  @click="exportRecords(selectedList.length > 0 ? 'selected' : 'all'); closeMenus()"
                  class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-700/60"
                >
                  <Download class="h-3.5 w-3.5" /> {{ selectedList.length > 0 ? `导出选中(${selectedList.length})` : '导出 JSON' }}
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
          <!-- 网格 / 列表切换 -->
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
          </div>
        </div>

        <!-- 筛选行：排序 / 类型 / 大小 + 共 N 张 -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs dark:border-gray-800">
          <!-- 排序下拉 -->
          <div class="relative flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">排序：</span>
            <button
              @click="showSortMenu = !showSortMenu; showBatchMenu = false; showTypeMenu = false; showSizeMenu = false"
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
          <div class="relative flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">类型：</span>
            <button
              @click="showTypeMenu = !showTypeMenu; showBatchMenu = false; showSortMenu = false; showSizeMenu = false"
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
          <div class="relative flex items-center gap-1.5">
            <span class="text-gray-400 dark:text-gray-500">大小：</span>
            <button
              @click="showSizeMenu = !showSizeMenu; showBatchMenu = false; showSortMenu = false; showTypeMenu = false"
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
          <p class="ml-auto text-xs tabular-nums text-gray-400 dark:text-gray-500">
            共 {{ filteredList.length }} 张图片
          </p>
        </div>
      </div>

      <!-- 快捷键帮助 -->
      <div v-if="showShortcuts" class="card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">↑</kbd>/<kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">↓</kbd> 选择</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Enter</kbd> 预览</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">F2</kbd> 复制链接</span>
        <span><kbd class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-800">Del</kbd> 删除</span>
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
          v-if="selectedList.length > 0"
          class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200/60 bg-indigo-50/70 px-5 py-3 dark:border-indigo-500/20 dark:bg-indigo-900/20"
        >
          <p class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            已选 <span class="font-bold">{{ selectedList.length }}</span> 项
            <button @click="clearSelection" class="ml-2 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400">
              取消选择
            </button>
          </p>
          <div class="flex flex-wrap items-center gap-2">
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
        <div v-if="loading" class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
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
          <p class="text-base font-semibold text-gray-500 dark:text-gray-400">{{ keyword || typeFilter !== 'all' || sizeFilter !== 'all' ? '没有匹配的图片' : trashMode ? '回收站是空的' : '暂无上传记录' }}</p>
          <p v-if="keyword || typeFilter !== 'all' || sizeFilter !== 'all'" class="text-xs text-gray-400 dark:text-gray-500">换个条件试试</p>
          <RouterLink
            v-else-if="!trashMode"
            to="/"
            class="brand-gradient mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            去上传第一张图
          </RouterLink>
        </div>

        <div v-else class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
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
                @click="lightboxItem = item"
                class="block h-full w-full cursor-zoom-in"
                title="点击查看大图"
              >
                <img
                  :src="item.thumbnailUrl || item.url"
                  :alt="item.name"
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </button>
              <!-- 左上：多选 checkbox（hover/已选时显示） -->
              <label
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
              <!-- 右上：… 更多菜单 -->
              <div class="absolute right-2.5 top-2.5">
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
              <p class="truncate text-xs font-semibold text-gray-800 sm:text-sm dark:text-gray-100" :title="item.name">{{ item.name }}</p>
              <p class="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{{ formatSize(item.size) }}</span>
                <span>{{ formatDate(item.createdAt) }}</span>
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
        <div v-if="!loading && filteredList.length > 0 && totalPages > 1" class="mt-4 flex items-center justify-between">
          <p class="text-xs tabular-nums text-gray-400 dark:text-gray-500">
            第 {{ page }} / {{ totalPages }} 页
          </p>
          <div class="flex items-center gap-2">
            <button
              @click="page--"
              :disabled="page <= 1"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              title="上一页"
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
            <button
              @click="page++"
              :disabled="page >= totalPages"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              title="下一页"
            >
              <ChevronRight class="h-4 w-4" />
            </button>
          </div>
        </div>
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
          <p class="text-lg font-medium">{{ keyword || typeFilter !== 'all' || sizeFilter !== 'all' ? '没有匹配的图片' : trashMode ? '回收站是空的' : '暂无上传记录' }}</p>
          <p v-if="keyword || typeFilter !== 'all' || sizeFilter !== 'all'" class="mt-1 text-sm">换个条件试试</p>
          <RouterLink
            v-else-if="!trashMode"
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
                @change="toggleSelect(item.id)"
                class="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
                title="选择此项"
              />
              <!-- 缩略图 -->
              <button
                @click="lightboxItem = item"
                class="h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                title="点击查看大图"
              >
                <img
                  :src="item.thumbnailUrl || item.url"
                  class="h-full w-full rounded-lg object-cover"
                  alt="preview"
                  loading="lazy"
                  decoding="async"
                />
              </button>

              <!-- 文件名 + 链接（弹性主列，最小宽度 0 才能正确截断） -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100" :title="item.name">
                  {{ item.name }}
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
          <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-gray-100/50 px-4 py-3 dark:border-gray-800/50">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              共 {{ filteredList.length }} 条 · 第 {{ page }} / {{ totalPages }} 页
            </p>
            <div class="flex items-center gap-2">
              <button
                @click="page--"
                :disabled="page <= 1"
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                title="上一页"
              >
                <ChevronLeft class="h-4 w-4" />
              </button>
              <button
                @click="page++"
                :disabled="page >= totalPages"
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                title="下一步"
              >
                <ChevronRight class="h-4 w-4" />
              </button>
            </div>
          </div>
        </template>
      </div>
      </template>

      <!-- 点任意空白关闭下拉 / 卡片菜单：菜单本身 stop 冒泡，只有遮罩能关 -->
      <div
        v-if="showBatchMenu || showSortMenu || showTypeMenu || showSizeMenu || openMenuId"
        class="fixed inset-0 z-20 cursor-default"
        @click="closeMenus"
      />

      <div class="mt-2 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm text-indigo-700 dark:border-indigo-900/30 dark:bg-indigo-900/10 dark:text-indigo-300">
        <AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
        <p>
          {{ trashMode
            ? '回收站中的记录保留 30 天后自动清除；彻底删除不会物理删除 CNB 上的图片文件。'
            : '删除仅移除 EdgeOne KV 中的链接记录并进入回收站（30 天），不会物理删除 CNB 上的图片文件。' }}
        </p>
      </div>
    </div>
  </AppShell>

  <!-- 弹层统一 Teleport 到 body：祖先的 backdrop-filter 会劫持 fixed 定位 -->
  <Teleport to="body">
    <!-- 大图预览 -->
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
          <img
            :src="lightboxItem.url"
            :alt="lightboxItem.name"
            class="max-h-[80vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
          />
          <div class="mt-3 flex max-w-full items-center gap-3">
            <p class="min-w-0 truncate text-xs text-white/80" :title="lightboxItem.name">{{ lightboxItem.name }}</p>
            <a
              :href="lightboxItem.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              原图 <ExternalLink class="h-3 w-3" />
            </a>
          </div>
          <button
            @click="lightboxItem = null"
            class="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg transition-transform hover:scale-105 dark:bg-gray-800 dark:text-gray-200"
            title="关闭预览"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </Transition>

    <!-- 删除确认弹窗（单条 / 批量共用） -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="showDeleteDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" @click="closeDeleteDialog"></div>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-desc"
          class="animate-modal-pop relative w-full max-w-sm overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
        >

          <div class="flex flex-col items-center px-7 pb-7 pt-8 text-center">
            <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20 dark:bg-red-500/15">
              <AlertCircle class="h-7 w-7 animate-icon-shake text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.45)] dark:text-red-400" />
            </div>
            <h3 id="delete-dialog-title" class="text-lg font-bold text-gray-900 dark:text-white">
              {{ pendingBatchDelete
                ? (trashMode ? `彻底删除这 ${selectedList.length} 条记录？` : `删除这 ${selectedList.length} 条记录？`)
                : (trashMode ? '彻底删除这条记录？' : '删除这条记录？') }}
            </h3>

            <!-- 单条：展示文件名；批量：展示前几条文件名 + 数量汇总 -->
            <div
              v-if="pendingBatchDelete"
              id="delete-dialog-desc"
              class="mt-4 w-full rounded-xl bg-gray-100/80 px-3.5 py-2.5 text-left dark:bg-gray-800/60"
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
              id="delete-dialog-desc"
              class="mt-4 w-full break-all rounded-xl bg-gray-100/80 px-3.5 py-2.5 text-left font-mono text-xs leading-relaxed text-gray-600 line-clamp-2 dark:bg-gray-800/60 dark:text-gray-300"
              :title="pendingDelete?.name"
            >{{ pendingDelete?.name }}</p>

            <p class="mt-3 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
              {{ trashMode
                ? '将从 KV 中彻底移除记录，CNB 上的原图文件不受影响。'
                : '记录将移入回收站（保留 30 天），CNB 上的原图文件不受影响。' }}
            </p>

            <div class="mt-6 flex w-full flex-col gap-3 sm:flex-row">
              <button
                ref="cancelBtn"
                @click="closeDeleteDialog"
                class="h-11 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                @click="pendingBatchDelete ? handleBatchDelete() : pendingDelete && handleDelete(pendingDelete)"
                :disabled="deleting"
                class="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-sm font-bold text-white shadow-lg shadow-red-500/30 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" />
                <Trash2 v-else class="h-4 w-4" />
                {{ deleting ? '删除中…' : '删除' }}
              </button>
            </div>
          </div>
        </div>
      </div>
  </Transition>
  </Teleport>
</template>
