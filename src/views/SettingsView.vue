<script setup lang="ts">
import { computed } from 'vue'
import { Settings, RotateCcw, Images } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { useUploadSettings } from '@/composables/useUploadSettings'
import { toast } from 'vue-sonner'

// 上传压缩为浏览器端 WebP 管线，仅调整参数，不改变上传接口行为
const { settings, resetSettings } = useUploadSettings()

const qualityOptions = [
  { value: 0.5, label: '0.5', hint: '最小' },
  { value: 0.6, label: '0.6', hint: '较小' },
  { value: 0.7, label: '0.7', hint: '推荐' },
  { value: 0.8, label: '0.8', hint: '较清晰' },
  { value: 0.9, label: '0.9', hint: '最清晰' },
]

const activeHint = computed(
  () => qualityOptions.find((q) => q.value === settings.value.quality)?.hint || '自定义',
)

const handleReset = () => {
  resetSettings()
  toast.success('已恢复默认设置')
}
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white">
          <Settings class="h-6 w-6 text-blue-600 dark:text-blue-400" />
          我的设置
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">上传压缩与外观偏好（保存在本机浏览器）</p>
      </div>

      <!-- 压缩质量 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-bold text-gray-900 dark:text-white">图片压缩质量</p>
            <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              上传时自动转为 WebP，质量越低体积越小。当前：{{ settings.quality }}（{{ activeHint }}）
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="q in qualityOptions"
              :key="q.value"
              @click="settings.quality = q.value"
              class="flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 text-sm font-bold transition-all"
              :class="
                settings.quality === q.value
                  ? 'brand-gradient text-white shadow-lg shadow-blue-500/25'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              "
            >
              <span>{{ q.label }}</span>
              <span
                v-if="q.hint"
                class="text-[10px] font-medium"
                :class="settings.quality === q.value ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'"
              >{{ q.hint }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 缩略图开关 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
              <Images class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-bold text-gray-900 dark:text-white">生成缩略图链接</p>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                关闭后仅保留原图链接，上传更快；已保存的结果卡不受影响
              </p>
            </div>
          </div>
          <button
            role="switch"
            :aria-checked="settings.generateThumbnail"
            :title="settings.generateThumbnail ? '点击关闭' : '点击开启'"
            @click="settings.generateThumbnail = !settings.generateThumbnail"
            class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            :class="settings.generateThumbnail ? 'brand-gradient' : 'bg-gray-300 dark:bg-gray-700'"
          >
            <span
              class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              :class="settings.generateThumbnail ? 'translate-x-5' : ''"
            ></span>
          </button>
        </div>
      </div>

      <!-- 外观主题 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-bold text-gray-900 dark:text-white">外观主题</p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">切换日间 / 夜间模式</p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <!-- 恢复默认 -->
      <div class="flex justify-end">
        <button
          @click="handleReset"
          class="flex h-10 items-center gap-2 rounded-xl bg-gray-100 px-4 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RotateCcw class="h-4 w-4" />
          恢复默认设置
        </button>
      </div>
    </div>
  </AppShell>
</template>
