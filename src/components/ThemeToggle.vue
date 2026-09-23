<script setup lang="ts">
import { computed } from 'vue'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { Sun, Moon, Monitor } from 'lucide-vue-next'

const { theme } = useTheme()

const props = withDefaults(
  defineProps<{
    /** 紧凑模式：顶栏使用，仅图标 + 胶囊，不占横向空间 */
    compact?: boolean
  }>(),
  { compact: false },
)

const options: Array<{ value: ThemeMode; label: string; icon: any }> = [
  { value: 'light', label: '日间', icon: Sun },
  { value: 'dark', label: '夜间', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const currentIcon = computed(() => options.find((o) => o.value === theme.value)?.icon || Sun)
const currentLabel = computed(() => options.find((o) => o.value === theme.value)?.label || '')
</script>

<template>
  <!-- 紧凑模式：顶栏胶囊（图标 + 文字，如目标图的「跟随系统」） -->
  <button
    v-if="props.compact"
    @click="
      theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    "
    class="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-600 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
    :title="`当前：${currentLabel}，点击切换`"
  >
    <component :is="currentIcon" class="h-4 w-4" />
    <span class="hidden sm:inline">{{ currentLabel }}</span>
    <span class="sr-only">切换主题</span>
  </button>
  <!-- 完整模式：三态循环切换（设置页等宽松位置使用） -->
  <button
    v-else
    @click="
      theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    "
    class="flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2 text-gray-600 transition-all hover:border-gray-200 hover:bg-white hover:text-indigo-600 hover:shadow-sm active:scale-95 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
    :title="`当前：${currentLabel}，点击切换`"
  >
    <component :is="currentIcon" class="h-5 w-5" />
    <span class="hidden text-xs font-medium sm:inline">{{ currentLabel }}</span>
    <span class="sr-only">切换主题</span>
  </button>
</template>
