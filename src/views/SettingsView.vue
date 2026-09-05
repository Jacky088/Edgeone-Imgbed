<script setup lang="ts">
import { computed } from 'vue'
import { Settings, RotateCcw, Images, Copy, Ruler, FileText, Rows3, Type } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { useUploadSettings, PAGE_SIZE_OPTIONS, type CopyFormat, type NamingRule } from '@/composables/useUploadSettings'
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

const maxDimensionOptions = [
  { value: 0, label: '不限制' },
  { value: 3840, label: '4K' },
  { value: 2560, label: '2K' },
  { value: 1920, label: '1920px' },
  { value: 1280, label: '1280px' },
]

const namingOptions: Array<{ value: NamingRule; label: string; hint: string }> = [
  { value: 'original', label: '保留原名', hint: '同名可能覆盖' },
  { value: 'timestamp', label: '时间戳', hint: '如 20260905-153001' },
  { value: 'random', label: '随机 ID', hint: '短随机字符' },
]

const copyFormatOptions: Array<{ value: CopyFormat; label: string }> = [
  { value: 'url', label: '直链' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'bbcode', label: 'BBCode' },
]

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

      <!-- 压缩尺寸上限 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
            <Ruler class="h-5 w-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-gray-900 dark:text-white">压缩尺寸上限</p>
            <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              长边超过上限时等比缩小，进一步减小体积
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="opt in maxDimensionOptions"
                :key="opt.value"
                @click="settings.maxDimension = opt.value"
                class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                :class="
                  settings.maxDimension === opt.value
                    ? 'brand-gradient text-white shadow-md shadow-blue-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 开关组：原图上传 / 缩略图 / 自动复制 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex flex-col divide-y divide-gray-100/70 dark:divide-gray-800/50">
          <!-- 保持原图 -->
          <div class="flex items-center justify-between gap-4 pb-5">
            <div class="flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
                <Images class="h-5 w-5" />
              </div>
              <div>
                <p class="text-sm font-bold text-gray-900 dark:text-white">保持原图上传</p>
                <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  跳过压缩保留原格式（GIF 动图始终保留以维持动画）
                </p>
              </div>
            </div>
            <button
              role="switch"
              :aria-checked="settings.keepOriginal"
              :title="settings.keepOriginal ? '点击关闭' : '点击开启'"
              @click="settings.keepOriginal = !settings.keepOriginal"
              class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              :class="settings.keepOriginal ? 'brand-gradient' : 'bg-gray-300 dark:bg-gray-700'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                :class="settings.keepOriginal ? 'translate-x-5' : ''"
              ></span>
            </button>
          </div>

          <!-- 缩略图 -->
          <div class="flex items-center justify-between gap-4 py-5">
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

          <!-- 上传后自动复制 -->
          <div class="flex items-center justify-between gap-4 pt-5">
            <div class="flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
                <Copy class="h-5 w-5" />
              </div>
              <div>
                <p class="text-sm font-bold text-gray-900 dark:text-white">上传后自动复制</p>
                <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  全部上传完成后，自动按下方默认格式复制链接
                </p>
              </div>
            </div>
            <button
              role="switch"
              :aria-checked="settings.autoCopy"
              :title="settings.autoCopy ? '点击关闭' : '点击开启'"
              @click="settings.autoCopy = !settings.autoCopy"
              class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              :class="settings.autoCopy ? 'brand-gradient' : 'bg-gray-300 dark:bg-gray-700'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                :class="settings.autoCopy ? 'translate-x-5' : ''"
              ></span>
            </button>
          </div>
        </div>
      </div>

      <!-- 文件命名规则 + 默认复制格式 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="grid gap-6 md:grid-cols-2">
          <div>
            <div class="flex items-center gap-2">
              <Type class="h-4 w-4 text-blue-500" />
              <p class="text-sm font-bold text-gray-900 dark:text-white">文件命名规则</p>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">决定存储在图床里的文件名</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="opt in namingOptions"
                :key="opt.value"
                @click="settings.namingRule = opt.value"
                class="flex flex-col items-center rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                :class="
                  settings.namingRule === opt.value
                    ? 'brand-gradient text-white shadow-md shadow-blue-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                <span>{{ opt.label }}</span>
                <span
                  class="text-[10px] font-medium"
                  :class="settings.namingRule === opt.value ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'"
                >{{ opt.hint }}</span>
              </button>
            </div>
          </div>

          <div>
            <div class="flex items-center gap-2">
              <FileText class="h-4 w-4 text-blue-500" />
              <p class="text-sm font-bold text-gray-900 dark:text-white">默认复制格式</p>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">自动复制与结果卡首推的格式</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="opt in copyFormatOptions"
                :key="opt.value"
                @click="settings.defaultCopyFormat = opt.value"
                class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                :class="
                  settings.defaultCopyFormat === opt.value
                    ? 'brand-gradient text-white shadow-md shadow-blue-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 列表每页条数 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <!-- 窄窗口时上下堆叠，避免文字被挤压成竖排 -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
              <Rows3 class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">列表每页条数</p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">图片列表分页大小：当前 {{ settings.pageSize }} 条</p>
            </div>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              v-for="n in PAGE_SIZE_OPTIONS"
              :key="n"
              @click="settings.pageSize = n"
              class="h-8 w-12 rounded-lg text-xs font-bold transition-all"
              :class="
                settings.pageSize === n
                  ? 'brand-gradient text-white shadow-md shadow-blue-500/25'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              "
            >
              {{ n }}
            </button>
          </div>
        </div>
      </div>

      <!-- 外观主题 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div class="min-w-0">
            <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">外观主题</p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">日间 / 夜间 / 跟随系统</p>
          </div>
          <div class="shrink-0"><ThemeToggle /></div>
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
