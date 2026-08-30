<script setup lang="ts">
import { ref, computed } from 'vue'
import { buildFormats, type UploadResult, type LinkFormatKey } from '@/utils/formatLinks'
import { Link2, Code2, Braces, Hash, Copy, Check, ChevronDown, Image as ImageIcon, Server } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{ info: UploadResult }>()

// 链接以外的格式默认收起，批量上传时避免整页卡片过长
const showMore = ref(false)

// 嵌入哪种 URL：原图 or 缩略图
const baseUrl = ref<'cdn' | 'thumb'>('cdn')

const formats = computed(() => {
  const base =
    baseUrl.value === 'thumb' && props.info.thumbnailUrl
      ? props.info.thumbnailUrl
      : props.info.url
  return buildFormats(props.info, base)
})

// 当前刚复制成功的格式 key，用于绿色"已复制"反馈
const justCopied = ref<LinkFormatKey | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const formatIcons: Record<LinkFormatKey, any> = {
  url: Link2,
  html: Code2,
  markdown: Braces,
  bbcode: Hash,
}

const copyToClipboard = async (key: LinkFormatKey, text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    justCopied.value = key
    toast.success('已复制到剪贴板')
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      justCopied.value = null
    }, 1500)
  } catch (err) {
    console.error(err)
    toast.error('复制失败，请尝试手动选中复制')
  }
}

// 预览图回退链：thumbnailUrl → url → urlOriginal
const previewSrc = computed(() => props.info.thumbnailUrl || props.info.url)

const onPreviewError = (e: Event) => {
  const img = e.target as HTMLImageElement
  if (img.src === props.info.thumbnailUrl && props.info.url) {
    img.src = props.info.url
  } else if (img.src === props.info.url && props.info.urlOriginal) {
    img.src = props.info.urlOriginal || ''
  }
}
</script>

<template>
  <div class="glass-card-premium overflow-hidden rounded-3xl shadow-2xl shadow-blue-500/5 ring-1 ring-white/20 dark:shadow-blue-500/10 dark:ring-white/5">
    <!-- 卡片头部 -->
    <div class="relative flex items-center gap-3 border-b border-gray-100/80 bg-gradient-to-r from-white/80 via-white/60 to-white/80 px-6 py-5 backdrop-blur-sm dark:border-gray-800/50 dark:from-gray-900/80 dark:via-gray-900/60 dark:to-gray-900/80">
      <div class="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-lg shadow-green-500/30">
        <div class="h-3.5 w-3.5 animate-pulse rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]"></div>
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="text-lg font-bold text-gray-900 dark:text-white">上传成功</h3>
        <p class="truncate text-xs text-gray-500 dark:text-gray-400" :title="info.name">{{ info.name || '图片已处理并上传至云端' }}</p>
      </div>
      <span v-if="info.compressionRatio != null" class="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-600 dark:bg-green-900/30 dark:text-green-400">
        压缩 {{ info.compressionRatio.toFixed(0) }}%
      </span>
    </div>

    <div class="grid grid-cols-1 gap-8 p-6 lg:grid-cols-12 lg:p-8">
      <!-- 左：预览图 -->
      <div class="flex flex-col items-center justify-center gap-5 lg:col-span-4 lg:border-r lg:border-gray-100/50 lg:pr-8 lg:dark:border-gray-800/50">
        <div class="group relative aspect-square w-full max-w-[240px]">
          <div class="relative h-full overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-gray-50 to-gray-100 shadow-2xl ring-1 ring-gray-900/5 transition-all duration-500 group-hover:scale-[1.02] dark:border-gray-700 dark:from-gray-900 dark:to-gray-800 dark:ring-white/5">
            <img
              :src="previewSrc"
              class="h-full w-full object-cover"
              alt="Uploaded Preview"
              @error="onPreviewError"
            />
            <div class="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <a :href="info.url" target="_blank" class="translate-y-6 transition-all duration-300 group-hover:translate-y-0">
                <div class="flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 shadow-2xl ring-1 ring-gray-900/5 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white/95">
                  <ImageIcon class="h-4 w-4" />
                  查看原图
                </div>
              </a>
            </div>
          </div>
        </div>

        <!-- 缩略图 / 原图 切换 -->
        <div v-if="info.thumbnailUrl" class="inline-flex items-center gap-1 rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <button
            :class="baseUrl === 'cdn' ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300' : 'hover:text-gray-700 dark:hover:text-gray-200'"
            class="rounded-full px-3 py-1 transition-all"
            @click="baseUrl = 'cdn'"
          >原图</button>
          <button
            :class="baseUrl === 'thumb' ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300' : 'hover:text-gray-700 dark:hover:text-gray-200'"
            class="rounded-full px-3 py-1 transition-all"
            @click="baseUrl = 'thumb'"
          >缩略图</button>
        </div>
        <p class="text-xs font-medium text-gray-400 dark:text-gray-500">选择要嵌入的链接基准</p>
      </div>

      <!-- 右：四格式块 -->
      <div class="flex flex-col gap-4 lg:col-span-8">
        <div
          v-for="f in formats"
          v-show="f.key === 'url' || showMore"
          :key="f.key"
          class="group rounded-xl ring-1 ring-gray-200 transition-all hover:ring-blue-300 hover:shadow-md dark:ring-gray-800 dark:hover:ring-blue-700"
        >
          <div class="flex items-center justify-between gap-3 px-4 py-2">
            <div class="flex items-center gap-2">
              <component
                :is="formatIcons[f.key]"
                class="h-4 w-4 text-blue-600 dark:text-blue-400"
              />
              <span class="text-sm font-bold text-gray-900 dark:text-white">{{ f.label }}</span>
              <span class="text-xs text-gray-400 dark:text-gray-500">{{ f.hint }}</span>
            </div>
            <button
              @click="copyToClipboard(f.key, f.value)"
              class="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all"
              :class="justCopied === f.key
                ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-300'"
            >
              <Check v-if="justCopied === f.key" class="h-3.5 w-3.5" />
              <Copy v-else class="h-3.5 w-3.5" />
              {{ justCopied === f.key ? '已复制' : '复制' }}
            </button>
          </div>
          <div class="mx-4 mb-3 overflow-x-auto rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/50">
            <pre class="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">{{ f.value }}</pre>
          </div>
        </div>

        <!-- 次要格式展开 / 收起 -->
        <button
          v-if="formats.length > 1"
          @click="showMore = !showMore"
          class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 py-2 text-xs font-semibold text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
        >
          <ChevronDown class="h-3.5 w-3.5 transition-transform duration-200" :class="showMore ? 'rotate-180' : ''" />
          {{ showMore ? '收起格式' : '更多格式（HTML / Markdown / BBCode）' }}
        </button>

        <!-- 源站直连（备用） -->
        <div v-if="info.urlOriginal || info.thumbnailOriginalUrl" class="space-y-3 rounded-xl bg-gray-50/50 p-4 dark:bg-gray-900/30">
          <h4 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <Server class="h-3.5 w-3.5 text-gray-400" />
            源站直连 (备用)
          </h4>

          <div
            v-if="info.urlOriginal"
            @click="copyToClipboard('url', info.urlOriginal!)"
            class="group flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200/60 bg-white/50 px-4 py-2.5 text-xs text-gray-600 transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:border-gray-700/50 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <span class="truncate font-mono">{{ info.urlOriginal }}</span>
            <Copy class="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <div
            v-if="info.thumbnailOriginalUrl"
            @click="copyToClipboard('url', info.thumbnailOriginalUrl!)"
            class="group flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200/60 bg-white/50 px-4 py-2.5 text-xs text-gray-600 transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:border-gray-700/50 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <span class="truncate font-mono">{{ info.thumbnailOriginalUrl }}</span>
            <Copy class="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
