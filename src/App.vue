<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
import { useTheme } from '@/composables/useTheme'

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
    :toastOptions="{
      // 核心样式升级：
      // 1. 阴影升级: 使用 !shadow-[...] 自定义多层阴影，制造悬浮感
      // 2. 边框质感: !border !border-gray-200/60 增加极细的内描边
      // 3. 布局微调: 增加 !gap-4 让图标和文字呼吸感更强
      class: 'my-toast-card relative flex flex-col items-center justify-center text-center !bg-white dark:!bg-gray-800 !bg-opacity-100 !opacity-100 !rounded-3xl !border !border-gray-200/50 dark:!border-gray-700/50 !shadow-[0_35px_60px_-15px_rgba(0,0,0,0.15),0_0_20px_rgba(0,0,0,0.05)] !py-8 !px-10 !text-[15px] !font-medium !min-w-[340px] !min-h-[140px] gap-4',
      duration: 2500
    }"
  />
</template>

<style>
:root {
  --toaster-width: auto !important;
}

/* 1. 强制全屏居中布局 (保持不变，这是居中的关键) */
ol[data-sonner-toaster] {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100vh !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  pointer-events: none !important;
  z-index: 99999 !important;
  background: transparent !important;
  /* 增加一点背景遮罩，让弹窗出现时背景稍微变暗，聚焦视线 (可选) */
  /* background: rgba(0, 0, 0, 0.02) !important; */
}

li[data-sonner-toast] {
  pointer-events: auto !important;
  margin: 0 !important;
  transform: none !important;
}

/* 2. 图标美化 */
.my-toast-card svg {
  width: 32px !important; /* 图标稍微加大 */
  height: 32px !important;
  /* 给图标增加一点投影 */
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); 
}

/* 3. 关闭按钮精修 */
.my-toast-card [data-close-button] {
  position: absolute !important;
  top: 14px !important;
  right: 14px !important;
  left: auto !important;
  transform: none !important;
  background-color: transparent !important;
  border: none !important;
  cursor: pointer !important;
  
  /* 按钮颜色微调 */
  color: #a1a1aa !important; 
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  
  /* 增加按钮尺寸方便点击 */
  width: 24px !important;
  height: 24px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 9999px !important; /* 圆形 */
}

/* 关闭按钮 Hover 效果：轻微背景色 + 颜色加深 */
.my-toast-card [data-close-button]:hover {
  color: #52525b !important;
  background-color: rgba(0,0,0,0.06) !important;
}

/* 暗色模式适配 */
.dark .my-toast-card {
  /* 夜间模式增加更强的发光阴影，防止卡片融入背景 */
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 20px 50px -12px rgba(0,0,0,0.8) !important;
}
.dark .my-toast-card [data-close-button] {
  color: #71717a !important;
}
.dark .my-toast-card [data-close-button]:hover {
  color: #e4e4e7 !important;
  background-color: rgba(255,255,255,0.1) !important;
}
</style>
