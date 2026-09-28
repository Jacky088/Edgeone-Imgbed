<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { AlertCircle, Loader2, Trash2 } from 'lucide-vue-next'

// 应用内确认弹窗（AdminView 删除确认 / SettingsView 孤儿清理确认共用）：
// 焦点自动落在「取消」上（手滑回车不会误确认），Escape / 遮罩可取消，loading 中不可关闭
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmText?: string
    cancelText?: string
    loading?: boolean
  }>(),
  { description: '', confirmText: '删除', cancelText: '取消', loading: false },
)

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

const cancelBtn = ref<HTMLButtonElement | null>(null)

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !props.loading) emit('cancel')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      cancelBtn.value?.focus()
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
        <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" @click="!loading && emit('cancel')"></div>
        <div
          class="animate-modal-pop relative w-full max-w-sm overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
        >
          <div class="flex flex-col items-center px-7 pb-7 pt-8 text-center">
            <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20 dark:bg-red-500/15">
              <AlertCircle class="h-7 w-7 animate-icon-shake text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.45)] dark:text-red-400" />
            </div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ title }}</h3>
            <div v-if="$slots.default" class="mt-4 w-full"><slot /></div>
            <p v-if="description" class="mt-3 text-xs leading-relaxed text-gray-400 dark:text-gray-500">{{ description }}</p>
            <div class="mt-6 flex w-full flex-col gap-3 sm:flex-row">
              <button
                ref="cancelBtn"
                @click="emit('cancel')"
                :disabled="loading"
                class="h-11 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {{ cancelText }}
              </button>
              <button
                @click="emit('confirm')"
                :disabled="loading"
                class="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-sm font-bold text-white shadow-lg shadow-red-500/30 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
                <Trash2 v-else class="h-4 w-4" />
                {{ loading ? '处理中…' : confirmText }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
