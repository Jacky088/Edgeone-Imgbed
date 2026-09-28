<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-vue-next'
import { useUploadSettings, PAGE_SIZE_OPTIONS } from '@/composables/useUploadSettings'

// 分页条：数字页码（当前页 ±1 + 首末页省略号）+ 首/末页 + 每页条数快捷切换
// （每页条数写入全局设置，与设置页「列表每页条数」同一份数据）
const props = defineProps<{ page: number; totalPages: number; total: number }>()
const emit = defineEmits<{ (e: 'update:page', value: number): void }>()

const { settings } = useUploadSettings()

const pages = computed<(number | '…')[]>(() => {
  const t = Math.max(1, props.totalPages)
  const c = Math.min(Math.max(1, props.page), t)
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const items: (number | '…')[] = [1]
  const lo = Math.max(2, c - 1)
  const hi = Math.min(t - 1, c + 1)
  if (lo > 2) items.push('…')
  for (let i = lo; i <= hi; i++) items.push(i)
  if (hi < t - 1) items.push('…')
  items.push(t)
  return items
})

const go = (p: number) => emit('update:page', Math.min(Math.max(1, p), props.totalPages))

const navBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40'
const numBtn = (active: boolean) =>
  `flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-xs font-semibold tabular-nums transition-colors ${
    active
      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
  }`
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-xs tabular-nums text-gray-400 dark:text-gray-500">共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</p>
    <div class="flex flex-wrap items-center gap-1.5">
      <select
        v-model="settings.pageSize"
        title="每页条数"
        class="mr-1 h-8 rounded-lg border border-gray-200 bg-white px-1.5 text-xs font-semibold text-gray-600 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
      >
        <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }} 条/页</option>
      </select>
      <template v-if="totalPages > 1">
        <button :class="navBtn" :disabled="page <= 1" title="首页" @click="go(1)">
          <ChevronsLeft class="h-4 w-4" />
        </button>
        <button :class="navBtn" :disabled="page <= 1" title="上一页" @click="go(page - 1)">
          <ChevronLeft class="h-4 w-4" />
        </button>
        <template v-for="(p, i) in pages" :key="i">
          <span v-if="p === '…'" class="px-0.5 text-xs text-gray-400">…</span>
          <button v-else :class="numBtn(p === page)" @click="go(p)">{{ p }}</button>
        </template>
        <button :class="navBtn" :disabled="page >= totalPages" title="下一页" @click="go(page + 1)">
          <ChevronRight class="h-4 w-4" />
        </button>
        <button :class="navBtn" :disabled="page >= totalPages" title="末页" @click="go(totalPages)">
          <ChevronsRight class="h-4 w-4" />
        </button>
      </template>
    </div>
  </div>
</template>
