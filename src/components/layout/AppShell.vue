<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import {
  CloudUpload,
  GalleryVertical,
  Settings,
  Info,
  LogOut,
  Cloud,
  Upload,
} from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'

const route = useRoute()
const router = useRouter()

const menu = [
  { name: 'home', label: '上传图片', icon: CloudUpload, to: '/' },
  { name: 'admin', label: '图片列表', icon: GalleryVertical, to: '/admin' },
  { name: 'settings', label: '我的设置', icon: Settings, to: '/settings' },
  { name: 'about', label: '关于项目', icon: Info, to: '/about' },
] as const

const handleLogout = () => {
  sessionStorage.removeItem('site_access_token')
  router.push('/login')
}
</script>

<template>
  <div class="aurora-bg relative min-h-dvh w-full overflow-x-hidden transition-colors duration-500">
    <div class="mx-auto flex min-h-dvh max-w-[1400px] gap-8 p-3 sm:p-6 lg:p-8">
      <!-- 左：品牌落地区（仅大屏 >= 1024px 显示） -->
      <aside class="hidden w-[340px] shrink-0 flex-col justify-between py-8 lg:flex">
        <div>
          <div class="mb-8 flex items-center gap-4">
            <div class="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 text-white shadow-xl shadow-blue-500/30 ring-1 ring-white/20">
              <Cloud class="h-7 w-7" :stroke-width="2.5" />
              <div class="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/10 to-transparent"></div>
            </div>
            <div>
              <h1 class="text-3xl font-black tracking-tight text-gray-900 dark:text-white">
                Edgeone-Imgbed
              </h1>
            </div>
          </div>

          <p class="mb-6 max-w-[300px] text-lg font-medium leading-relaxed text-gray-500 dark:text-gray-400">
            基于 EO 和 CNB 对象存储的简易图床服务
          </p>

          <!-- 渐变分隔线 -->
          <div class="mb-8 h-1 w-24 rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400"></div>

          <!-- 技术徽章 -->
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-white/40 backdrop-blur dark:bg-white/10 dark:text-gray-200 dark:ring-white/10">
              <div class="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-sky-400 text-[10px] font-black text-white">EO</div>
              EdgeOne
            </div>
            <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-white/40 backdrop-blur dark:bg-white/10 dark:text-gray-200 dark:ring-white/10">
              <div class="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-emerald-400 to-teal-500 text-[10px] font-black text-white">CB</div>
              CloudBase
            </div>
          </div>
        </div>

        <!-- 装饰：云朵 + 浮动小球（纯 CSS） -->
        <div class="relative hidden h-64 select-none lg:block">
          <div class="absolute bottom-0 left-1/2 -translate-x-1/2">
            <div class="relative h-24 w-56">
              <div class="absolute bottom-6 left-8 h-16 w-24 rounded-3xl bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-10 left-2 h-12 w-12 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-8 right-0 h-10 w-10 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-12 left-14 h-12 w-12 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-8 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg shadow-blue-500/30">
                <Upload class="h-7 w-7" />
              </div>
            </div>
          </div>
          <div class="absolute left-[18%] top-10 h-3 w-3 animate-float rounded-full bg-sky-400/60 blur-[1px]"></div>
          <div class="absolute left-[70%] top-20 h-4 w-4 animate-float rounded-full bg-emerald-400/50 blur-[1px] [animation-delay:0.6s]"></div>
          <div class="absolute left-[40%] top-4 h-2.5 w-2.5 animate-float rounded-full bg-violet-400/50 blur-[1px] [animation-delay:1.1s]"></div>
          <div class="absolute left-[85%] top-6 h-3 w-3 animate-float rounded-full bg-blue-400/50 blur-[1px] [animation-delay:1.6s]"></div>
        </div>
      </aside>

      <!-- 右：应用窗口（固定视口高，内容区内滚，底部标签栏常驻） -->
      <section class="glass-card flex h-[calc(100dvh-1rem)] flex-1 flex-col overflow-hidden rounded-3xl sm:h-[calc(100dvh-2rem)] sm:rounded-[2rem]">
        <!-- 标题栏 -->
        <header class="flex h-14 shrink-0 items-center justify-between border-b border-gray-100/80 bg-white/60 px-4 backdrop-blur-xl dark:border-gray-800/50 dark:bg-gray-900/60 sm:h-16 sm:px-6">
          <div class="flex items-center gap-2.5 sm:gap-3">
            <div class="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20 sm:h-9 sm:w-9">
              <Cloud class="h-4 w-4 sm:h-5 sm:w-5" :stroke-width="2.5" />
              <div class="absolute inset-0 rounded-xl bg-gradient-to-t from-black/10 to-transparent"></div>
            </div>
            <span class="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-lg font-bold tracking-tight text-transparent dark:from-white dark:via-gray-200 dark:to-white sm:text-xl">
              Edgeone-Imgbed
            </span>
          </div>

          <div class="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <button
              @click="handleLogout"
              class="group relative flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition-all hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 sm:w-auto sm:px-4 sm:text-sm sm:font-medium"
              title="退出登录"
            >
              <div class="absolute inset-0 rounded-xl bg-red-50 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-red-900/10"></div>
              <LogOut class="relative h-4 w-4" />
              <span class="relative ml-1.5 hidden font-medium sm:inline">注销</span>
            </button>
          </div>
        </header>

        <!-- 内容区：桌面端左侧垂直侧栏；平板/手机自动切换为底部标签栏 -->
        <div class="flex min-h-0 flex-1">
          <!-- 桌面垂直侧栏（仅 >=1024px） -->
          <nav class="hidden w-52 shrink-0 flex-col gap-1.5 border-r border-gray-100/80 bg-white/40 p-4 backdrop-blur lg:flex dark:border-gray-800/50 dark:bg-gray-900/40">
            <RouterLink
              v-for="item in menu"
              :key="item.name"
              :to="item.to"
              class="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all"
              :class="
                route.name === item.name
                  ? 'bg-gradient-to-r from-blue-500/15 to-sky-400/10 text-blue-700 ring-1 ring-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30'
                  : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100'
              "
            >
              <component
                :is="item.icon"
                class="h-[18px] w-[18px]"
                :class="route.name === item.name ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300'"
              />
              {{ item.label }}
            </RouterLink>
          </nav>

          <!-- 主内容 -->
          <main class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <slot />
          </main>
        </div>

        <!-- 移动 / 平板底部标签栏（<1024px），大触控目标 + 安全区 -->
        <nav class="flex shrink-0 items-stretch border-t border-gray-100/80 bg-white/80 backdrop-blur-xl dark:border-gray-800/50 dark:bg-gray-900/80 lg:hidden" style="padding-bottom: env(safe-area-inset-bottom)">
          <RouterLink
            v-for="item in menu"
            :key="item.name"
            :to="item.to"
            class="flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors"
            :class="
              route.name === item.name
                ? 'text-blue-600 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            "
          >
            <component :is="item.icon" class="h-6 w-6" :stroke-width="route.name === item.name ? 2.5 : 2" />
            <span class="text-[11px] font-medium">{{ item.label }}</span>
          </RouterLink>
        </nav>
      </section>
    </div>
  </div>
</template>
