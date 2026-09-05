<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
</script>

<template>
  <RouterView />

  <!-- 全站统一 toast：顶部居中胶囊（日间深底白字 / 夜间浅底深字），配色与关闭钮样式统一在 main.css 覆盖 -->
  <Toaster position="top-center" closeButton :toastOptions="{ duration: 2500 }" />
</template>
