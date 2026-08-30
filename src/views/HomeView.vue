<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import ResultCard from '@/components/ResultCard.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Link2, Braces, Trash2 } from 'lucide-vue-next'
import { buildFormats, type UploadResult } from '@/utils/formatLinks'
import { useUploadSettings } from '@/composables/useUploadSettings'

// 上传压缩参数：从设置页读取（localStorage 持久化），仍是原 WebP 压缩管线
const { settings } = useUploadSettings()

// 批量上传：逐张收集上传结果
const results = ref<UploadResult[]>([])

const handleUploadSuccess = (info: UploadResult) => {
  results.value.push(info)
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

// 复用 buildFormats，保证与单卡复制一致的转义规则
const copyAll = (key: 'url' | 'markdown') => {
  const text = results.value
    .map((r) => buildFormats(r, r.url).find((f) => f.key === key)?.value || '')
    .filter(Boolean)
    .join('\n')
  if (!text) return
  copyText(text, `已复制 ${results.value.length} 条${key === 'url' ? '链接' : ' Markdown'}`)
}

const clearResults = () => {
  results.value = []
}
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <!-- 上传组件 - 精致卡片 -->
      <div class="glass-card-premium overflow-hidden rounded-3xl p-6 shadow-2xl shadow-blue-500/5 ring-1 ring-white/20 dark:shadow-blue-500/10 dark:ring-white/5">
        <FileUploader
          @update:uploadInfo="handleUploadSuccess"
          :maxHeight="5000"
          :maxWidth="5000"
          :quality="settings.quality"
          :generateThumbnail="settings.generateThumbnail"
          :thumbnailMaxWidth="400"
          :thumbnailMaxHeight="800"
          :thumbnailQuality="0.8"
        />
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
        <div v-if="results.length" class="space-y-6">
          <!-- 批量结果工具栏 -->
          <div class="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3">
            <p class="text-sm font-semibold text-gray-700 dark:text-gray-200">
              上传成功 <span class="text-blue-600 dark:text-blue-400">{{ results.length }}</span> 张
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button
                @click="copyAll('url')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                <Link2 class="h-3.5 w-3.5" />
                复制全部链接
              </button>
              <button
                @click="copyAll('markdown')"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                <Braces class="h-3.5 w-3.5" />
                复制全部 Markdown
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
    </div>
  </AppShell>
</template>
