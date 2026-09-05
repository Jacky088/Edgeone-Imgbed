<script setup lang="ts">
import { computed } from 'vue'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { Sun, Moon, Monitor } from 'lucide-vue-next'

const { theme } = useTheme()

const options: Array<{ value: ThemeMode; label: string; icon: any }> = [
  { value: 'light', label: '日间', icon: Sun },
  { value: 'dark', label: '夜间', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const currentIcon = computed(() => options.find((o) => o.value === theme.value)?.icon || Sun)
const currentLabel = computed(() => options.find((o) => o.value === theme.value)?.label || '')
</script>

<template>
  <!-- 三态循环切换：日间 → 夜间 → 跟随系统 -->
  <button
    @click="
      theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    "
    class="flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2 text-gray-600 transition-all hover:border-gray-200 hover:bg-white hover:text-blue-600 hover:shadow-sm active:scale-95 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-blue-400"
    :title="`当前：${currentLabel}，点击切换`"
  >
    <component :is="currentIcon" class="h-5 w-5" />
    <span class="hidden text-xs font-medium sm:inline">{{ currentLabel }}</span>
    <span class="sr-only">切换主题</span>
  </button>
</template>
