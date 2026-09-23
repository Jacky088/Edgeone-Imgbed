<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useBucket } from '@/composables/useBucket'

// 顶栏存储桶徽标：只读展示当前桶名（单桶架构，无切换）；拿不到桶名时不渲染
const { bucket } = useBucket()
</script>

<template>
  <button
    v-if="bucket"
    class="hidden h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-600 sm:flex dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
    title="当前存储桶（单桶架构，仅展示）"
    @click="toast.info('当前仅一个存储桶')"
  >
    <span class="h-2 w-2 rounded-full bg-emerald-500" />
    {{ bucket }}
    <ChevronDown class="h-3.5 w-3.5 opacity-60" />
  </button>
</template>
