<script setup lang="ts">
import { Settings, Wrench } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppShell from '@/components/layout/AppShell.vue'
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white">
          <Settings class="h-6 w-6 text-blue-600 dark:text-blue-400" />
          我的设置
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">个性化配置即将上线</p>
      </div>

      <div class="glass-card-premium rounded-3xl p-8">
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
            <Wrench class="h-8 w-8" />
          </div>
          <div>
            <p class="text-lg font-bold text-gray-900 dark:text-white">设置功能开发中</p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">主题、口令、域名等个性化设置将在后续版本提供</p>
          </div>
        </div>
      </div>

      <!-- 可用的一项：主题切换 -->
      <div class="glass-card-premium rounded-3xl p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-bold text-gray-900 dark:text-white">外观主题</p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">切换日间 / 夜间模式</p>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  </AppShell>
</template>
