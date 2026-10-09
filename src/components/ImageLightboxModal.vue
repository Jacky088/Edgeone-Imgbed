<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  X,
  Copy,
  Check,
  FileCode2,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Download,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { copyTextFallback } from '@/utils/clipboard'
import { formatCompactSize } from '@/utils/format'

export interface LightboxImage {
  id?: string
  name: string
  url: string
  thumbnailUrl?: string
  size?: number
  type?: string
  width?: number
  height?: number
  createdAt?: number
}

const props = defineProps<{
  open: boolean
  image: LightboxImage | null
}>()

const emit = defineEmits<{
  close: []
}>()

const scale = ref(1)
const copiedLink = ref(false)
const copiedMd = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const resetZoom = () => {
  scale.value = 1
}

const zoomIn = () => {
  scale.value = Math.min(3, +(scale.value + 0.25).toFixed(2))
}

const zoomOut = () => {
  scale.value = Math.max(0.5, +(scale.value - 0.25).toFixed(2))
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      resetZoom()
      copiedLink.value = false
      copiedMd.value = false
    }
  },
)

const copyDirectUrl = async () => {
  if (!props.image?.url) return
  if (await copyTextFallback(props.image.url)) {
    copiedLink.value = true
    toast.success('直链已复制到剪贴板')
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedLink.value = false
    }, 1500)
  }
}

const copyMarkdown = async () => {
  if (!props.image?.url) return
  const md = `![${props.image.name || 'image'}](${props.image.url})`
  if (await copyTextFallback(md)) {
    copiedMd.value = true
    toast.success('Markdown 已复制到剪贴板')
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedMd.value = false
    }, 1500)
  }
}

const downloadImage = () => {
  if (!props.image?.url) return
  const a = document.createElement('a')
  a.href = props.image.url
  a.download = props.image.name || 'image'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const onKeyDown = (e: KeyboardEvent) => {
  if (!props.open) return
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (copyTimer) clearTimeout(copyTimer)
})

const extName = computed(() => {
  if (!props.image) return ''
  return (props.image.type?.split('/')[1] || props.image.name.split('.').pop() || '').toUpperCase()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && image"
      class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-md transition-opacity duration-300"
      @click.self="emit('close')"
    >
      <!-- 顶栏工具区 -->
      <div
        class="card mb-3 flex w-full max-w-4xl items-center justify-between gap-3 border-gray-800 bg-gray-900/90 px-4 py-2.5 text-white shadow-2xl backdrop-blur-lg"
      >
        <div class="flex min-w-0 items-center gap-2">
          <p class="truncate text-xs font-bold text-gray-100 sm:text-sm" :title="image.name">
            {{ image.name }}
          </p>
          <span
            v-if="extName"
            class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300"
          >
            {{ extName }}
          </span>
          <span
            v-if="image.size"
            class="hidden text-xs tabular-nums text-gray-400 sm:inline"
          >
            {{ formatCompactSize(image.size) }}
          </span>
          <span
            v-if="image.width && image.height"
            class="hidden text-xs tabular-nums text-gray-400 md:inline"
          >
            {{ image.width }} × {{ image.height }}
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1 sm:gap-2">
          <!-- 缩放控制 -->
          <div class="flex items-center rounded-lg bg-gray-800/80 p-0.5">
            <button
              @click="zoomOut"
              :disabled="scale <= 0.5"
              class="flex h-7 w-7 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-40"
              title="缩小"
            >
              <ZoomOut class="h-3.5 w-3.5" />
            </button>
            <button
              @click="resetZoom"
              class="px-1 text-[11px] font-semibold tabular-nums text-gray-300 hover:text-white"
              title="复位 100%"
            >
              {{ Math.round(scale * 100) }}%
            </button>
            <button
              @click="zoomIn"
              :disabled="scale >= 3"
              class="flex h-7 w-7 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-40"
              title="放大"
            >
              <ZoomIn class="h-3.5 w-3.5" />
            </button>
          </div>

          <!-- 复制直链 -->
          <button
            @click="copyDirectUrl"
            class="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all active:scale-95"
            :class="copiedLink ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'"
            title="复制直链"
          >
            <component :is="copiedLink ? Check : Copy" class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">{{ copiedLink ? '已复制' : '直链' }}</span>
          </button>

          <!-- 复制 Markdown -->
          <button
            @click="copyMarkdown"
            class="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all active:scale-95"
            :class="copiedMd ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'"
            title="复制 Markdown"
          >
            <component :is="copiedMd ? Check : FileCode2" class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">{{ copiedMd ? '已复制' : 'Markdown' }}</span>
          </button>

          <!-- 查看原图 -->
          <a
            :href="image.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700"
            title="新窗口打开原图"
          >
            <ExternalLink class="h-3.5 w-3.5" />
          </a>

          <!-- 下载原图 -->
          <button
            @click="downloadImage"
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700"
            title="下载原图"
          >
            <Download class="h-3.5 w-3.5" />
          </button>

          <!-- 关闭 -->
          <button
            @click="emit('close')"
            class="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-gray-300 transition-colors hover:bg-red-500/20 hover:text-red-300"
            title="关闭 (Esc)"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- 图片主展示区 -->
      <div
        class="relative flex flex-1 w-full max-w-5xl items-center justify-center overflow-hidden"
        @click.self="emit('close')"
      >
        <img
          :src="image.url"
          :alt="image.name"
          class="max-h-[calc(100vh-140px)] max-w-full select-none rounded-xl object-contain shadow-2xl transition-transform duration-200"
          :style="{ transform: `scale(${scale})` }"
          draggable="false"
        />
      </div>
    </div>
  </Teleport>
</template>
