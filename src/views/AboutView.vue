<script setup lang="ts">
import { Info, Cloud, Database, Rocket } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import pkg from '../../package.json'

// 版本号直接取自 package.json，保证与仓库实际版本一致
const version = `v${pkg.version}`
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white">
          <Info class="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          关于项目
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">了解 Edgeone-Imgbed</p>
      </div>

      <div class="card p-6 text-center sm:p-8">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 sm:h-16 sm:w-16">
          <Cloud class="h-7 w-7 sm:h-8 sm:w-8" />
        </div>
        <h3 class="text-xl font-black tracking-tight text-gray-900 sm:text-2xl dark:text-white">Edgeone-Imgbed</h3>
        <p class="mt-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">{{ version }}</p>
        <p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          基于 EdgeOne 与 CloudBase 对象存储构建的简易图床服务，自动压缩、生成缩略图、全球 CDN 加速。
        </p>

        <!-- 技术栈 -->
        <div class="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-3">
          <div class="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-100 dark:bg-gray-800/60 dark:ring-gray-700/50">
            <Rocket class="mx-auto mb-2 h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <p class="text-xs font-semibold text-gray-700 dark:text-gray-200">前端</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">Vue 3 + Tailwind</p>
          </div>
          <div class="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-100 dark:bg-gray-800/60 dark:ring-gray-700/50">
            <Cloud class="mx-auto mb-2 h-5 w-5 text-sky-500 dark:text-sky-400" />
            <p class="text-xs font-semibold text-gray-700 dark:text-gray-200">加速</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">EdgeOne CDN</p>
          </div>
          <div class="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-100 dark:bg-gray-800/60 dark:ring-gray-700/50">
            <Database class="mx-auto mb-2 h-5 w-5 text-emerald-500 dark:text-emerald-400" />
            <p class="text-xs font-semibold text-gray-700 dark:text-gray-200">存储</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">CNB 对象存储</p>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
