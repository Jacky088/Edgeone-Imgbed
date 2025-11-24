<script setup lang="ts">
import { RouterView } from 'vue-router'
// 1. 引入 Toaster 组件
import { Toaster } from 'vue-sonner'
import { useTheme } from '@/composables/useTheme'

// 2. 获取 theme，让弹窗也跟随日间/夜间模式变化
const { theme } = useTheme()
</script>

<template>
  <RouterView />
  
  <Toaster 
    position="top-center" 
    :theme="theme" 
    richColors 
    closeButton
    class="!z-[99999]" 
  />
</template>

<style>
/* 全局强制样式修复：防止 Tailwind v4 的重置影响 Toaster 的定位 */
:root {
  --toaster-z-index: 99999 !important;
}
</style>
