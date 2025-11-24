<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
// 引入并执行，确保应用启动时主题生效
import { useTheme } from '@/composables/useTheme'
useTheme()
</script>

<template>
  <RouterView />
  <Toaster position="top-center" />
</template>
