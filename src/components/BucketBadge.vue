<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { Check, ChevronDown, Cloud, HardDrive } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useBucket } from '@/composables/useBucket'

// 顶栏存储桶切换器：列出 CNB + 已配置 S3 桶，选择本机上传目标（仅影响本浏览器，站点默认在设置页改）
// 关闭策略：document 级 pointerdown 监听（点击穿透到目标，不吞事件）+ Esc；不再用全屏遮罩
const { bucket, storages, globalActive, effectiveId, fetchBucket, selectStorage } = useBucket()
fetchBucket()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)

const onDocPointerDown = (e: PointerEvent) => {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false
  }
}
const onDocKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && open.value) open.value = false
}

watch(open, (v) => {
  if (v) {
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown)
  }
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
})

const pick = (id: string) => {
  open.value = false
  if (id === effectiveId.value) return
  selectStorage(id)
  const label = storages.value.find((s) => s.id === id)?.label || id
  toast.success(`上传目标已切换：${label}（本机生效）`)
}
</script>

<template>
  <!-- 全尺寸常驻：小窗口/移动端也保证上传目标可见（标题与按钮自动收窄让位） -->
  <div ref="rootRef" v-if="bucket || storages.length > 0" class="relative">
    <button
      class="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-600 sm:px-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
      title="选择上传目标（本机生效）；站点默认在设置页修改"
      @click="open = !open"
    >
      <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
      <span class="max-w-[88px] truncate sm:max-w-[160px]">{{ bucket || 'CNB 对象存储' }}</span>
      <ChevronDown class="h-3.5 w-3.5 opacity-60 transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <!-- 下拉菜单：CNB + 全部 S3 桶 -->
    <div
      v-if="open"
      class="card absolute right-0 top-11 z-50 w-64 p-1.5 shadow-xl shadow-indigo-500/10"
    >
      <p class="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        上传目标（本机生效）
      </p>
      <button
        v-for="s in storages"
        :key="s.id"
        @click="pick(s.id)"
        class="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
        :class="effectiveId === s.id ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-gray-100/70 dark:hover:bg-gray-800/60'"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          :class="s.type === 'cnb' ? 'brand-gradient text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'"
        >
          <Cloud v-if="s.type === 'cnb'" class="h-3.5 w-3.5" />
          <HardDrive v-else class="h-3.5 w-3.5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5">
            <span class="truncate text-xs font-bold text-gray-900 dark:text-white">{{ s.label }}</span>
            <span
              v-if="globalActive === s.id"
              class="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
            >站点默认</span>
          </span>
          <span class="block truncate text-[10px] text-gray-400 dark:text-gray-500">
            {{ s.type === 'cnb' ? '内置存储' : `s3-${s.id}` }}
          </span>
        </span>
        <Check v-if="effectiveId === s.id" class="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
      </button>
    </div>
  </div>
</template>
