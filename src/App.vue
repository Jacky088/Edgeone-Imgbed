<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
import { useTheme } from '@/composables/useTheme'

const { theme } = useTheme()
</script>

<template>
  <RouterView />

  <!-- 紧凑玻璃 toast：圆角 + 毛玻璃 + 细描边，与全站玻璃卡片语言一致 -->
  <Toaster
    position="top-center"
    :theme="theme"
    richColors
    closeButton
    class="!z-[99999]"
    :toastOptions="{
      class: '!rounded-2xl !border !bg-white/85 !border-white/60 !text-sm !font-medium !shadow-xl backdrop-blur-xl dark:!bg-gray-900/85 dark:!border-white/10',
      duration: 2500,
    }"
  />
</template>
