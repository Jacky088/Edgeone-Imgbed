<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
</script>

<template>
  <RouterView />

  <!-- 全站统一 toast：顶部居中胶囊（日间深底白字 / 夜间浅底深字），配色与关闭钮样式统一在 main.css 覆盖。
       offset/mobileOffset：桌面 24px、移动端 16px；最终定位由 main.css 的视口钉扎规则兜底强制 -->
  <Toaster
    position="top-center"
    closeButton
    :offset="24"
    :mobileOffset="{ top: 16 }"
    :toastOptions="{ duration: 2500 }"
  />
</template>
