<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
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
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Loader2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { buildFormats } from '@/utils/formatLinks'
import AppShell from '@/components/layout/AppShell.vue'

interface ImageRecord {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  type: string
  createdAt: number
}

const list = ref<ImageRecord[]>([])
const loading = ref(false)

// 前端搜索 + 排序 + 分页（数据已整表拉取，不再额外请求）
const keyword = ref('')
const page = ref(1)
const pageSize = 20

// 排序：默认按上传时间倒序（最新在前）
type SortKey = 'createdAt' | 'size' | 'name'
type SortDir = 'asc' | 'desc'
const sortKey = ref<SortKey>('createdAt')
const sortDir = ref<SortDir>('desc')

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
  const base = kw
    ? list.value.filter((item) => item.name.toLowerCase().includes(kw))
    : list.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...base].sort((a, b) => {
    if (sortKey.value === 'name') return a.name.localeCompare(b.name, 'zh-CN') * dir
    if (sortKey.value === 'size') return (a.size - b.size) * dir
    return (a.createdAt - b.createdAt) * dir
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredList.value.length / pageSize)))
const pagedList = computed(() =>
  filteredList.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)

watch(keyword, () => {
  page.value = 1
})
watch(totalPages, () => {
  if (page.value > totalPages.value) page.value = totalPages.value
})
// 翻页/搜索后清掉跨页残留的选择，避免批量操作误伤不可见行
watch([keyword, page], () => {
  selectedIds.value.clear()
  selectionVersion.value++
})

const fetchList = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/image-records', { baseURL: '' })
    if (data.code === 0) {
      list.value = data.data
    }
  } catch (e) {
    toast.error('获取列表失败')
  } finally {
    loading.value = false
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

// Escape 关闭弹层（lightbox 优先于删除确认；删除请求进行中不响应）
const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || deleting.value) return
  if (lightboxItem.value) {
    lightboxItem.value = null
  } else {
    closeDeleteDialog()
  }
}

const handleDelete = async (item: ImageRecord) => {
  if (deleting.value) return
  deleting.value = true
  try {
    const { data } = await axios.delete('/image-records', {
      baseURL: '',
      params: { id: item.id },
    })
    if (data.code === 0) {
      toast.success('记录已删除')
      list.value = list.value.filter((row) => row.id !== item.id)
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

const copyText = async (text: string, msg: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch (err) {
    console.error(err)
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

const pageAllSelected = computed(() => {
  selectionVersion.value
  return pagedList.value.length > 0 && pagedList.value.every((item) => selectedIds.value.has(item.id))
})

const togglePageSelection = () => {
  if (pageAllSelected.value) {
    for (const item of pagedList.value) selectedIds.value.delete(item.id)
  } else {
    for (const item of pagedList.value) selectedIds.value.add(item.id)
  }
  selectionVersion.value++
}

const selectedList = computed(() => {
  selectionVersion.value
  return list.value.filter((item) => selectedIds.value.has(item.id))
})

const clearSelection = () => {
  selectedIds.value.clear()
  selectionVersion.value++
}

const copySelected = (key: 'url' | 'markdown') => {
  const text = selectedList.value
    .map((item) => buildFormats(item, item.url).find((f) => f.key === key)?.value || '')
    .filter(Boolean)
    .join('\n')
  if (!text) return
  copyText(text, `已复制 ${selectedList.value.length} 条${key === 'url' ? '链接' : ' Markdown'}`)
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
  let ok = 0
  let fail = 0
  for (const item of selectedList.value) {
    try {
      const { data } = await axios.delete('/image-records', {
        baseURL: '',
        params: { id: item.id },
      })
      if (data.code === 0) {
        list.value = list.value.filter((row) => row.id !== item.id)
        ok++
      } else {
        fail++
      }
    } catch {
      fail++
    }
  }
  batchDeleting.value = false
  pendingBatchDelete.value = false
  clearSelection()
  if (fail === 0) {
    toast.success(`已删除 ${ok} 条记录`)
  } else {
    toast.warning(`${ok} 条删除成功，${fail} 条失败`)
  }
}

// 复用 buildFormats，保证与上传结果卡的转义规则一致
const copyFormat = (item: ImageRecord, key: 'url' | 'markdown') => {
  const fmt = buildFormats(item, item.url).find((f) => f.key === key)
  if (fmt) copyText(fmt.value, key === 'url' ? '链接已复制' : 'Markdown 已复制')
}

const formatDate = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  return (bytes / 1024).toFixed(2) + ' KB'
}

onMounted(() => {
  fetchList()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white">图片列表</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">管理已上传的链接记录</p>
        </div>

        <!-- 搜索框 -->
        <div class="relative w-full sm:w-64">
          <Search class="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索文件名..."
            class="h-10 w-full rounded-xl border border-gray-200 bg-white/60 pl-10 pr-9 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-100 dark:focus:bg-gray-800"
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
          class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200/60 bg-blue-50/70 px-5 py-3 dark:border-blue-500/20 dark:bg-blue-900/20"
        >
          <p class="text-sm font-semibold text-blue-700 dark:text-blue-300">
            已选 <span class="font-bold">{{ selectedList.length }}</span> 项
            <button @click="clearSelection" class="ml-2 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400">
              取消选择
            </button>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              @click="copySelected('url')"
              class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
            >
              <Copy class="h-3.5 w-3.5" />
              复制选中链接
            </button>
            <button
              @click="copySelected('markdown')"
              class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
            >
              <Braces class="h-3.5 w-3.5" />
              复制选中 Markdown
            </button>
            <button
              @click="askBatchDelete"
              :disabled="batchDeleting"
              class="flex h-8 items-center gap-1.5 rounded-lg bg-red-500 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 class="h-3.5 w-3.5" />
              删除选中 ({{ selectedList.length }})
            </button>
          </div>
        </div>
      </Transition>

      <div class="glass-card overflow-hidden rounded-[2rem]">
        <div v-if="loading" class="space-y-4 p-6">
          <!-- 骨架屏：模拟真实行高，加载完不跳动 -->
          <div v-for="i in 8" :key="i" class="flex items-center gap-4">
            <div class="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-gray-200/70 dark:bg-gray-700/50"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3.5 w-1/3 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/50"></div>
              <div class="h-3 w-1/4 animate-pulse rounded-full bg-gray-200/50 dark:bg-gray-700/30"></div>
            </div>
            <div class="hidden w-16 animate-pulse rounded-full bg-gray-200/50 sm:block h-3 dark:bg-gray-700/30"></div>
            <div class="hidden w-28 animate-pulse rounded-full bg-gray-200/50 md:block h-3 dark:bg-gray-700/30"></div>
          </div>
        </div>

        <div v-else-if="filteredList.length === 0" class="flex flex-col items-center justify-center p-20 text-gray-400 dark:text-gray-600">
          <FileImage class="mb-4 h-16 w-16 opacity-20" />
          <p class="text-lg font-medium">{{ keyword ? '没有匹配的图片' : '暂无上传记录' }}</p>
          <p v-if="keyword" class="mt-1 text-sm">换个关键词试试</p>
          <RouterLink
            v-else
            to="/"
            class="mt-5 brand-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            去上传第一张图
          </RouterLink>
        </div>

        <template v-else>
          <!-- 移动端卡片列表（<md），表格在小屏改为逐条卡片 -->
          <div class="divide-y divide-gray-100/50 md:hidden dark:divide-gray-800/50">
            <div v-for="item in pagedList" :key="item.id" class="flex items-center gap-3 px-4 py-3" :class="isSelected(item.id) ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''">
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                @change="toggleSelect(item.id)"
                class="h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
                title="选择此项"
              />
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
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100" :title="item.name">
                  {{ item.name }}
                </p>
                <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {{ formatSize(item.size) }} · {{ formatDate(item.createdAt) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center">
                <button
                  @click="copyFormat(item, 'url')"
                  class="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition dark:text-gray-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                  title="复制链接"
                >
                  <Copy class="h-4 w-4" />
                </button>
                <button
                  @click="copyFormat(item, 'markdown')"
                  class="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition dark:text-gray-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                  title="复制 Markdown"
                >
                  <Braces class="h-4 w-4" />
                </button>
                <button
                  @click="pendingDelete = item"
                  class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="删除记录"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- 桌面表格（>=md），表头吸顶跟随滚动 -->
          <div class="hidden overflow-x-auto md:block">
            <table class="w-full text-left text-sm">
              <thead class="sticky top-0 z-10 bg-white/95 text-gray-500 shadow-[0_1px_0_0_rgba(0,0,0,0.05)] backdrop-blur dark:bg-gray-900/95 dark:text-gray-400">
                <tr>
                  <th class="px-4 py-4 font-medium">
                    <input
                      type="checkbox"
                      :checked="pageAllSelected"
                      @change="togglePageSelection"
                      class="h-4 w-4 cursor-pointer accent-blue-600"
                      title="全选/取消本页"
                    />
                  </th>
                  <th class="px-6 py-4 font-medium">缩略图</th>
                  <th class="px-6 py-4 font-medium">
                    <button @click="toggleSort('name')" class="inline-flex items-center gap-1 transition-colors hover:text-blue-600 dark:hover:text-blue-300" title="按文件名排序">
                      文件名 / 链接
                      <ArrowUpDown v-if="sortKey !== 'name'" class="h-3 w-3 opacity-40" />
                      <ChevronUp v-else-if="sortDir === 'asc'" class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                      <ChevronDown v-else class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                    </button>
                  </th>
                  <th class="px-6 py-4 font-medium">
                    <button @click="toggleSort('size')" class="inline-flex items-center gap-1 transition-colors hover:text-blue-600 dark:hover:text-blue-300" title="按大小排序">
                      信息
                      <ArrowUpDown v-if="sortKey !== 'size'" class="h-3 w-3 opacity-40" />
                      <ChevronUp v-else-if="sortDir === 'asc'" class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                      <ChevronDown v-else class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                    </button>
                  </th>
                  <th class="px-6 py-4 font-medium">
                    <button @click="toggleSort('createdAt')" class="inline-flex items-center gap-1 transition-colors hover:text-blue-600 dark:hover:text-blue-300" title="按上传时间排序">
                      上传时间
                      <ArrowUpDown v-if="sortKey !== 'createdAt'" class="h-3 w-3 opacity-40" />
                      <ChevronUp v-else-if="sortDir === 'asc'" class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                      <ChevronDown v-else class="h-3 w-3 text-blue-600 dark:text-blue-300" />
                    </button>
                  </th>
                  <th class="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100/50 dark:divide-gray-800/50">
                <tr v-for="item in pagedList" :key="item.id" class="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors" :class="isSelected(item.id) ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''">
                <td class="px-4 py-4">
                  <input
                    type="checkbox"
                    :checked="isSelected(item.id)"
                    @change="toggleSelect(item.id)"
                    class="h-4 w-4 cursor-pointer accent-blue-600"
                    title="选择此项"
                  />
                </td>
                <td class="px-6 py-4">
                  <button
                    @click="lightboxItem = item"
                    class="block h-14 w-14 cursor-zoom-in overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
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
                </td>
                  <td class="px-6 py-4">
                    <div class="font-medium text-gray-900 truncate max-w-[240px] dark:text-gray-100" :title="item.name">
                      {{ item.name }}
                    </div>
                    <a :href="item.url" target="_blank" class="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
                      查看原图 <ExternalLink class="h-3 w-3" />
                    </a>
                  </td>
                  <td class="px-6 py-4 text-gray-500 dark:text-gray-400">
                    <div class="whitespace-nowrap font-mono text-xs">{{ formatSize(item.size) }}</div>
                    <div class="mt-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {{ item.type.split('/')[1] }}
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-6 py-4 text-gray-500 dark:text-gray-400">
                    {{ formatDate(item.createdAt) }}
                  </td>
                  <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <button
                        @click="copyFormat(item, 'url')"
                        class="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition dark:text-gray-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                        title="复制链接"
                      >
                        <Copy class="h-4 w-4" />
                      </button>
                      <button
                        @click="copyFormat(item, 'markdown')"
                        class="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition dark:text-gray-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                        title="复制 Markdown"
                      >
                        <Braces class="h-4 w-4" />
                      </button>
                      <button
                        @click="pendingDelete = item"
                        class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        title="删除记录"
                      >
                        <Trash2 class="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 分页 -->
          <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-gray-100/50 px-6 py-3 dark:border-gray-800/50">
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
                title="下一页"
              >
                <ChevronRight class="h-4 w-4" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <div class="mt-2 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-700 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-300">
        <AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
        <p>注意：删除操作仅移除 EdgeOne KV 中的链接记录，不会物理删除 CNB 上的图片文件。请定期登录 CNB 控制台清理。</p>
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
        <!-- 方向 A：玻璃 danger 卡。深浅两套底色 + 顶部高光描边 + 弹入动画 -->
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-desc"
          class="animate-modal-pop relative w-full max-w-sm overflow-hidden rounded-3xl bg-white/85 shadow-2xl ring-1 ring-white/60 backdrop-blur-2xl dark:bg-gray-900/85 dark:ring-white/10"
        >
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/25"></div>

          <div class="flex flex-col items-center px-7 pb-7 pt-8 text-center">
            <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20 dark:bg-red-500/15">
              <AlertCircle class="h-7 w-7 animate-icon-shake text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.45)] dark:text-red-400" />
            </div>
            <h3 id="delete-dialog-title" class="text-lg font-bold text-gray-900 dark:text-white">
              {{ pendingBatchDelete ? `删除这 ${selectedList.length} 条记录？` : '删除这条记录？' }}
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
              仅移除 KV 中的链接记录，CNB 上的原图文件不受影响。
            </p>

            <div class="mt-6 flex w-full flex-col gap-3 sm:flex-row">
              <button
                ref="cancelBtn"
                @click="closeDeleteDialog"
                class="h-11 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
