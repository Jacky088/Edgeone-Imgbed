<script setup lang="ts">
import { computed } from 'vue'
import { CloudUpload } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import FileUploader from '@/components/public/FileUploader.vue'
import ResultCard from '@/components/ResultCard.vue'
import { ref, nextTick, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import {
  Link2,
  Braces,
  Code2,
  Hash,
  Trash2,
  LayoutGrid,
  List,
  RefreshCw,
  SlidersHorizontal,
  Search,
  X,
  Cloud,
  HardDrive,
  Archive,
  CalendarCheck,
  ArrowRight,
  Link,
  Copy,
  FileCode2,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import axios from '@/utils/axios'
import { buildFormats, type UploadResult, type LinkFormatKey } from '@/utils/formatLinks'
import { copyTextFallback } from '@/utils/clipboard'
import { formatCompactSize, formatCompactCount, formatRecentTime } from '@/utils/format'
import { useBucket } from '@/composables/useBucket'
import { useGlobalStats } from '@/composables/useGlobalStats'
import { useUploadSettings } from '@/composables/useUploadSettings'

const { bucket, fetchBucket } = useBucket()
// 首页 ?stats=1 顺带拿到的统计直接写入全局侧栏，省一次请求
const { stats: globalStats } = useGlobalStats()

const router = useRouter()

// 上传压缩参数：从设置页读取（localStorage 持久化），仍是原 WebP 压缩管线
const { settings } = useUploadSettings()

// ---------- 顶部统计：首页挂载时拉一次 ?stats=1，统计卡 + 最近上传 + 侧栏存储卡共用 ----------
interface HomeStats {
  count: number
  totalSize: number
  trashed: number
  todayCount: number
}
interface RecentItem {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  type: string
  createdAt: number
}
const stats = ref<HomeStats | null>(null)
const recent = ref<RecentItem[]>([])
const loadingStats = ref(true)

const statCards = computed(() => [
  {
    label: '已上传图片',
    sub: '总数',
    value: stats.value ? formatCompactCount(stats.value.count) : '—',
    icon: Cloud,
    tint: 'bg-indigo-50 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  {
    label: '存储空间',
    sub: '已使用',
    value: stats.value ? formatCompactSize(stats.value.totalSize) : '—',
    icon: HardDrive,
    tint: 'bg-sky-50 text-sky-500 dark:bg-sky-500/15 dark:text-sky-300',
  },
  {
    label: '今日新增',
    sub: '图片',
    value: stats.value ? formatCompactCount(stats.value.todayCount) : '—',
    icon: CalendarCheck,
    tint: 'bg-violet-50 text-violet-500 dark:bg-violet-500/15 dark:text-violet-300',
  },
  {
    label: '回收站',
    sub: '暂存',
    value: stats.value ? formatCompactCount(stats.value.trashed) : '—',
    icon: Archive,
    tint: 'bg-amber-50 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300',
  },
])

const fetchHome = async () => {
  loadingStats.value = true
  fetchBucket()
  try {
    const { data } = await axios.get('/image-records', {
      baseURL: '',
      params: { stats: 1 },
    })
    if (data.code === 0 && !Array.isArray(data.data)) {
      stats.value = data.data.stats ?? null
      if (stats.value) globalStats.value = stats.value
      const records = (data.data.records ?? []) as RecentItem[]
      recent.value = [...records]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 4)
    }
  } catch {
    // 统计失败不打扰主流程，卡片显示占位
  } finally {
    loadingStats.value = false
  }
}

onMounted(fetchHome)

// ---------- 批量上传结果（上传成功后出现在最近上传下方） ----------
const results = ref<UploadResult[]>([])
const resultsSection = ref<HTMLElement | null>(null)

const handleUploadSuccess = (info: UploadResult) => {
  results.value.push(info)
  if (results.value.length === 1) {
    nextTick(() => resultsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // 上传成功后静默刷新统计与最近上传，保持四张卡为真数
  fetchHome()
}

const handleUploadFinished = async () => {
  if (!settings.value.autoCopy || results.value.length === 0) return
  const key = settings.value.defaultCopyFormat
  const text = results.value
    .map((r) => buildFormats(r, r.url).find((f) => f.key === key)?.value || '')
    .filter(Boolean)
    .join('\n')
  if (!text) return
  const label = { url: '链接', markdown: 'Markdown', html: 'HTML', bbcode: 'BBCode' }[key]
  if (await copyTextFallback(text)) {
    toast.success(`已自动复制 ${results.value.length} 条${label}`)
  } else {
    toast.info('自动复制失败，请手动复制')
  }
}

const copyText = async (text: string, msg: string) => {
  if (await copyTextFallback(text)) {
    toast.success(msg)
  } else {
    toast.error('复制失败，请尝试手动选中复制')
  }
}

const copyAll = (key: LinkFormatKey) => {
  const text = results.value
    .map((r) => buildFormats(r, r.url).find((f) => f.key === key)?.value || '')
    .filter(Boolean)
    .join('\n')
  if (!text) return
  const label = { url: '链接', markdown: 'Markdown', html: 'HTML', bbcode: 'BBCode' }[key]
  copyText(text, `已复制 ${results.value.length} 条${label}`)
}

const clearResults = () => {
  results.value = []
}

// ---------- 最近上传：搜索 / 刷新 / 网格-列表切换 / 卡片操作 ----------
const keyword = ref('')
const viewMode = ref<'grid' | 'list'>('grid')
const showSearch = ref(false)

const filteredRecent = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return recent.value
  return recent.value.filter((item) => item.name.toLowerCase().includes(kw))
})

const recentAction = async (item: RecentItem, action: 'link' | 'copy' | 'code' | 'delete') => {
  if (action === 'link' || action === 'copy') {
    copyText(item.url, action === 'link' ? '链接已复制' : '链接已复制')
  } else if (action === 'code') {
    const fmt = buildFormats({ url: item.url, name: item.name }, item.url).find((f) => f.key === 'markdown')
    if (fmt) copyText(fmt.value, 'Markdown 已复制')
  } else {
    try {
      const { data } = await axios.delete('/image-records', {
        baseURL: '',
        params: { id: item.id },
      })
      if (data.code === 0) {
        recent.value = recent.value.filter((r) => r.id !== item.id)
        toast.success('已移入回收站，30 天内可恢复')
        fetchHome()
      } else {
        toast.error(data.msg || '删除失败')
      }
    } catch {
      toast.error('删除失败')
    }
  }
}

const goBatch = () => router.push('/admin')
</script>

<template>
  <AppShell>
    <div class="flex min-w-0 flex-col gap-4 sm:gap-5">
      <!-- 统计卡：桌面 4 列；窗口化窄屏 2 列；移动端 2 列 -->
      <div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <div
          v-for="card in statCards"
          :key="card.label"
          class="card flex items-center gap-3 p-4 sm:gap-4 sm:p-5"
        >
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12"
            :class="card.tint"
          >
            <component :is="card.icon" class="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-xs text-gray-400 dark:text-gray-500">{{ card.label }}</p>
            <p class="truncate text-lg font-black tabular-nums text-gray-900 sm:text-xl dark:text-white">
              {{ card.value }}
            </p>
            <p class="text-[11px] text-gray-400 dark:text-gray-500">{{ card.sub }}</p>
          </div>
        </div>
      </div>

      <!-- 上传区 -->
      <div class="card overflow-hidden p-4 sm:p-6">
        <!-- maxDimension 为长边上限：宽高传同一个值形成正方形包络盒，等价于"长边 ≤ 上限"；0 表示不限制 -->
        <FileUploader
          variant="hero"
          @update:uploadInfo="handleUploadSuccess"
          @upload:finished="handleUploadFinished"
          :maxHeight="settings.maxDimension"
          :maxWidth="settings.maxDimension"
          :quality="settings.quality"
          :generateThumbnail="settings.generateThumbnail"
          :thumbnailMaxWidth="400"
          :thumbnailMaxHeight="800"
          :thumbnailQuality="0.8"
        />
      </div>

      <!-- 最近上传 -->
      <div class="flex flex-col gap-3 sm:gap-4">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 class="mr-auto text-base font-bold text-gray-900 sm:text-lg dark:text-white">最近上传</h2>
          <!-- 搜索：窄屏收起为图标按钮 -->
          <div class="relative hidden sm:block">
            <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索文件名..."
              class="h-9 w-44 rounded-xl border border-gray-200 bg-white pl-9 pr-8 text-xs outline-none transition-all placeholder:text-gray-400 focus:w-56 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 lg:w-52 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100"
            />
            <button
              v-if="keyword"
              @click="keyword = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="清空搜索"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            v-if="!showSearch"
            @click="showSearch = true"
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm sm:hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
            title="搜索"
          >
            <Search class="h-4 w-4" />
          </button>
          <button
            @click="goBatch"
            class="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
          >
            <SlidersHorizontal class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">批量操作</span>
          </button>
          <button
            @click="fetchHome"
            class="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
            title="刷新"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="loadingStats ? 'animate-spin' : ''" />
            <span class="hidden sm:inline">刷新</span>
          </button>
          <div class="flex h-9 items-center gap-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <button
              @click="viewMode = 'list'"
              class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
              :class="viewMode === 'list' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              title="列表视图"
            >
              <List class="h-4 w-4" />
            </button>
            <button
              @click="viewMode = 'grid'"
              class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
              :class="viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              title="网格视图"
            >
              <LayoutGrid class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 移动端展开的搜索框 -->
        <div v-if="showSearch" class="relative sm:hidden">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索文件名..."
            class="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-sm outline-none placeholder:text-gray-400 focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100"
          />
          <button
            @click="showSearch = false; keyword = ''"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            title="关闭搜索"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- 空态 -->
        <div v-if="!loadingStats && filteredRecent.length === 0" class="card flex flex-col items-center justify-center gap-2 p-10 text-center">
          <CloudUpload class="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p class="text-sm font-semibold text-gray-500 dark:text-gray-400">{{ keyword ? '没有匹配的图片' : '还没有上传记录' }}</p>
          <p v-if="keyword" class="text-xs text-gray-400 dark:text-gray-500">换个条件试试</p>
        </div>

        <!-- 网格视图：桌面 4 列；窗口化 2~3 列；移动端 2 列 -->
        <div v-else-if="viewMode === 'grid'" class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          <div
            v-for="item in filteredRecent"
            :key="item.id"
            class="card group overflow-hidden"
          >
            <div class="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-800">
              <a :href="item.url" target="_blank" rel="noopener noreferrer" title="查看原图">
                <img
                  :src="item.thumbnailUrl || item.url"
                  :alt="item.name"
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </a>
            </div>
            <div class="p-3">
              <p class="truncate text-xs font-semibold text-gray-800 sm:text-sm dark:text-gray-100" :title="item.name">{{ item.name }}</p>
              <p class="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{{ formatCompactSize(item.size) }}</span>
                <span class="rounded bg-gray-100 px-1 py-px text-[10px] font-bold uppercase dark:bg-gray-800">{{ (item.type || '').split('/')[1] }}</span>
                <span>{{ formatRecentTime(item.createdAt) }}</span>
              </p>
              <div class="mt-2 flex items-center gap-1">
                <button
                  v-for="act in ([
                    { key: 'link', icon: Link, title: '复制链接' },
                    { key: 'copy', icon: Copy, title: '复制链接' },
                    { key: 'code', icon: FileCode2, title: '复制 Markdown' },
                    { key: 'delete', icon: Trash2, title: '移入回收站' },
                  ] as const)"
                  :key="act.key"
                  @click="recentAction(item, act.key)"
                  :title="act.title"
                  class="flex h-8 flex-1 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                  :class="act.key === 'delete' ? 'hover:!bg-red-50 hover:!text-red-500 dark:hover:!bg-red-500/10 dark:hover:!text-red-400' : ''"
                >
                  <component :is="act.icon" class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 列表视图 -->
        <div v-else class="card divide-y divide-gray-100 overflow-hidden dark:divide-gray-800">
          <div
            v-for="item in filteredRecent"
            :key="item.id"
            class="flex items-center gap-3 px-3 py-2.5 sm:px-4"
          >
            <a :href="item.url" target="_blank" rel="noopener noreferrer" class="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800" title="查看原图">
              <img
                :src="item.thumbnailUrl || item.url"
                :alt="item.name"
                loading="lazy"
                decoding="async"
                class="h-full w-full object-cover"
              />
            </a>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-gray-800 sm:text-sm dark:text-gray-100" :title="item.name">{{ item.name }}</p>
              <p class="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{{ formatCompactSize(item.size) }}</span>
                <span class="hidden rounded bg-gray-100 px-1 py-px text-[10px] font-bold uppercase sm:inline dark:bg-gray-800">{{ (item.type || '').split('/')[1] }}</span>
                <span>{{ formatRecentTime(item.createdAt) }}</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center">
              <button @click="recentAction(item, 'link')" title="复制链接" class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300">
                <Link class="h-4 w-4" />
              </button>
              <button @click="recentAction(item, 'code')" title="复制 Markdown" class="hidden rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 sm:block dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300">
                <Code2 class="h-4 w-4" />
              </button>
              <button @click="recentAction(item, 'delete')" title="移入回收站" class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 上传结果列表 -->
      <Transition
        enter-active-class="transition-all duration-700 ease-out"
        enter-from-class="opacity-0 translate-y-12 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-300 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-8 scale-95"
      >
        <div v-if="results.length" ref="resultsSection" class="flex flex-col gap-4">
          <div class="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <p class="text-sm font-semibold text-gray-700 dark:text-gray-200">
              上传成功 <span class="text-indigo-600 dark:text-indigo-400">{{ results.length }}</span> 张
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button
                @click="copyAll('url')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                <Link2 class="h-3.5 w-3.5" />
                复制全部链接
              </button>
              <button
                @click="copyAll('markdown')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                <Braces class="h-3.5 w-3.5" />
                复制全部 Markdown
              </button>
              <button
                @click="copyAll('html')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                <Code2 class="h-3.5 w-3.5" />
                复制全部 HTML
              </button>
              <button
                @click="copyAll('bbcode')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
              >
                <Hash class="h-3.5 w-3.5" />
                复制全部 BBCode
              </button>
              <button
                @click="clearResults"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-500 transition-colors hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
              >
                <Trash2 class="h-3.5 w-3.5" />
                清空结果
              </button>
            </div>
          </div>

          <ResultCard v-for="(info, idx) in results" :key="idx + '-' + (info.name || idx)" :info="info" />
        </div>
      </Transition>

      <!-- 去图片列表 -->
      <button
        v-if="stats && stats.count > 4"
        @click="router.push('/admin')"
        class="card group flex items-center justify-center gap-2 p-3.5 text-sm font-semibold text-gray-500 transition-colors hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-300"
      >
        查看全部 {{ stats.count }} 张图片
        <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  </AppShell>
</template>
