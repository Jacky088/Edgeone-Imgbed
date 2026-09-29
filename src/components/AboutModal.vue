<script setup lang="ts">
import { Cloud, Database, Rocket, X, Github } from 'lucide-vue-next'
import pkg from '../../package.json'

// 关于项目弹窗：顶栏"关于"按钮唤起；版本号直接取自 package.json，保证与仓库实际版本一致
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const version = `v${pkg.version}`
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="card relative w-full max-w-sm p-6 text-center sm:p-8">
        <button
          @click="emit('close')"
          class="absolute right-3 top-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="关闭"
        >
          <X class="h-4 w-4" />
        </button>

        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 sm:h-16 sm:w-16">
          <Cloud class="h-7 w-7 sm:h-8 sm:w-8" />
        </div>
        <h3 class="text-xl font-black tracking-tight text-gray-900 sm:text-2xl dark:text-white">CNB图床</h3>
        <p class="mt-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">{{ version }}</p>
        <p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          基于 EdgeOne 与 CNB 对象存储构建的简易图床服务，自动压缩、生成缩略图、全球 CDN 加速。
        </p>

        <!-- 技术栈 -->
        <div class="mx-auto mt-6 grid max-w-lg gap-3 grid-cols-3">
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

        <a
          href="https://github.com/Jacky088/Edgeone-Imgbed"
          target="_blank"
          rel="noopener"
          class="mx-auto mt-6 inline-flex h-9 items-center gap-1.5 rounded-xl bg-gray-100 px-4 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-900 hover:text-white dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white dark:hover:text-gray-900"
        >
          <Github class="h-3.5 w-3.5" />
          GitHub 仓库
        </a>
      </div>
    </div>
  </Teleport>
</template>
