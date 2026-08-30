<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
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

// 前端搜索 + 分页（数据已整表拉取，不再额外请求）
const keyword = ref('')
const page = ref(1)
const pageSize = 20

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter((item) => item.name.toLowerCase().includes(kw))
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

// 应用内删除确认（替代原生 confirm）
const pendingDelete = ref<ImageRecord | null>(null)

// 缩略图点击后的大图预览
const lightboxItem = ref<ImageRecord | null>(null)

// Escape 关闭弹层（lightbox 优先于删除确认）
const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (lightboxItem.value) {
    lightboxItem.value = null
  } else {
    pendingDelete.value = null
  }
}

const handleDelete = async (item: ImageRecord) => {
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

// 复用 buildFormats，保证与上传结果卡的转义规则一致
const copyFormat = (item: ImageRecord, key: 'url' | 'markdown') => {
  const fmt = buildFormats(item, item.url).find((f) => f.key === key)
  if (fmt) copyText(fmt.value, key === 'url' ? '链接已复制' : 'Markdown 已复制')
}

const formatDate = (ts: number) => {
  return new Date(ts).toLocaleString()
}

const formatSize = (bytes: number) => {
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

      <div class="glass-card overflow-hidden rounded-[2rem]">
        <div v-if="loading" class="p-12 text-center text-gray-500 dark:text-gray-400">
          <div class="animate-pulse">加载数据中...</div>
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
            <div v-for="item in pagedList" :key="item.id" class="flex items-center gap-3 px-4 py-3">
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

          <!-- 桌面表格（>=md） -->
          <div class="hidden overflow-x-auto md:block">
            <table class="w-full text-left text-sm">
              <thead class="bg-gray-50/50 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400">
                <tr>
                  <th class="px-6 py-4 font-medium">缩略图</th>
                  <th class="px-6 py-4 font-medium">文件名 / 链接</th>
                  <th class="px-6 py-4 font-medium">信息</th>
                  <th class="px-6 py-4 font-medium">上传时间</th>
                  <th class="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100/50 dark:divide-gray-800/50">
                <tr v-for="item in pagedList" :key="item.id" class="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
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
                    <div class="font-mono text-xs">{{ formatSize(item.size) }}</div>
                    <div class="mt-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {{ item.type.split('/')[1] }}
                    </div>
                  </td>
                  <td class="px-6 py-4 text-gray-500 dark:text-gray-400">
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

    <!-- 删除确认弹窗 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="pendingDelete" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" @click="pendingDelete = null"></div>
      <div class="glass-card-premium relative w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle class="h-7 w-7" />
        </div>
        <h3 class="text-lg font-bold text-gray-900 dark:text-white">确认删除这条记录？</h3>
        <p class="mt-2 truncate text-xs text-gray-500 dark:text-gray-400" :title="pendingDelete.name">{{ pendingDelete.name }}</p>
        <p class="mt-3 text-xs leading-relaxed text-gray-400 dark:text-gray-500">仅移除 KV 中的链接记录，远程文件不会被删除。</p>
        <div class="mt-6 flex gap-3">
          <button
            @click="pendingDelete = null"
            class="h-11 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            @click="handleDelete(pendingDelete)"
            class="h-11 flex-1 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-sm font-bold text-white shadow-lg shadow-red-500/30 transition-all hover:from-red-400 hover:to-rose-400"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>
