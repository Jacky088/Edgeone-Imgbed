<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import {
  CloudUpload,
  GalleryVertical,
  Settings,
  Info,
  LogOut,
  Cloud,
  Github,
  Archive,
} from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'

const route = useRoute()
const router = useRouter()

// 回收站是图片列表的一种视图（/admin?view=trash），但作为一级导航项单独露出
const menu = computed(() => [
  { label: '上传图片', icon: CloudUpload, to: '/', active: route.name === 'home' },
  {
    label: '图片列表',
    icon: GalleryVertical,
    to: '/admin',
    active: route.name === 'admin' && route.query.view !== 'trash',
  },
  {
    label: '回收站',
    icon: Archive,
    to: { path: '/admin', query: { view: 'trash' } },
    active: route.name === 'admin' && route.query.view === 'trash',
  },
  { label: '我的设置', icon: Settings, to: '/settings', active: route.name === 'settings' },
  { label: '关于项目', icon: Info, to: '/about', active: route.name === 'about' },
])

// header 展示当前页面标题（大屏左侧品牌区已有站名，避免重复）
const pageTitle = computed(() => {
  if (route.name === 'admin' && route.query.view === 'trash') return '回收站'
  return menu.value.find((item) => item.active)?.label || 'Edgeone-Imgbed'
})

const handleLogout = () => {
  sessionStorage.removeItem('site_access_token')
  localStorage.removeItem('site_access_token')
  router.push('/login')
}
</script>

<template>
  <div class="aurora-bg relative min-h-dvh w-full overflow-x-hidden transition-colors duration-500">
    <div class="mx-auto flex min-h-dvh max-w-[1920px] gap-8 p-3 sm:p-6 lg:p-8">
      <!-- 左：品牌落地区
           响应式策略：保证右侧应用窗口始终有足够宽度，宁可隐藏品牌区也不挤压内容。
           xl (>=1280px) 才显示品牌区；1024–1279px 只显示应用窗口 + 桌面侧栏。 -->
      <aside class="hidden w-[340px] shrink-0 flex-col justify-between py-8 xl:flex 2xl:w-[420px]">
        <div>
          <div class="mb-8 flex items-center gap-4">
            <div class="relative flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white shadow-xl shadow-blue-500/30 ring-1 ring-white/20">
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

          <!-- 品牌渐变分隔线 -->
          <div class="mb-8 h-1 w-24 rounded-full brand-gradient"></div>

          <!-- 技术徽章 -->
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-white/40 backdrop-blur dark:bg-white/10 dark:text-gray-200 dark:ring-white/10">
              <div class="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-sky-400 text-[10px] font-black text-white">EO</div>
              EdgeOne
            </div>
            <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-white/40 backdrop-blur dark:bg-white/10 dark:text-gray-200 dark:ring-white/10">
              <div class="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-emerald-400 to-teal-500 text-[10px] font-black text-white">CB</div>
              CloudBase
            </div>
            <a
              href="https://github.com/Jacky088/Edgeone-Imgbed"
              target="_blank"
              rel="noopener noreferrer"
              title="在 GitHub 上查看项目"
              class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-white/40 backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:text-white dark:bg-white/10 dark:text-gray-200 dark:ring-white/10 dark:hover:bg-white dark:hover:text-gray-900"
            >
              <Github class="h-4 w-4" />
              GitHub
            </a>
          </div>
        </div>

        <!-- 装饰：云朵 + 流动几何图形（纯 CSS，动态效果更明显） -->
        <div class="relative hidden h-72 select-none xl:block">
          <!-- 云朵，整体缓慢上下浮动 -->
          <div class="absolute bottom-0 left-1/2 -translate-x-1/2 animate-bob">
            <div class="relative h-24 w-56">
              <div class="absolute bottom-6 left-8 h-16 w-24 rounded-3xl bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-10 left-2 h-12 w-12 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-8 right-0 h-10 w-10 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <div class="absolute bottom-12 left-14 h-12 w-12 rounded-full bg-gradient-to-br from-blue-100/80 to-sky-200/60 backdrop-blur dark:from-blue-900/40 dark:to-sky-900/30"></div>
              <!-- 云朵上的 GitHub 链接（左下角，点击新窗口打开仓库；置于最顶层避免被几何图形遮挡） -->
              <a
                href="https://github.com/Jacky088/Edgeone-Imgbed"
                target="_blank"
                rel="noopener noreferrer"
                title="在 GitHub 上查看项目"
                class="absolute bottom-8 left-1/2 z-20 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br from-gray-900 to-gray-700 text-white shadow-lg shadow-gray-900/30 transition-all hover:scale-110 hover:from-gray-800 hover:to-gray-600"
              >
                <Github class="h-7 w-7" />
              </a>
            </div>
          </div>

          <!-- 流动几何图形：三角/圆/圆角方块，主题同色系，缓慢漂移旋转 -->
          <div class="absolute left-[6%] top-6 h-16 w-16 animate-geo rounded-2xl bg-gradient-to-br from-sky-400/50 to-blue-500/35 [animation-delay:0s] dark:from-sky-500/30 dark:to-blue-600/20"></div>
          <div class="absolute left-[30%] top-16 h-12 w-12 animate-geo rounded-full bg-gradient-to-br from-emerald-400/50 to-teal-500/35 [animation-delay:2.5s] dark:from-emerald-500/30 dark:to-teal-600/20"></div>
          <div class="absolute left-[52%] top-4 h-14 w-14 animate-geo [clip-path:polygon(50%_0,100%_100%,0_100%)] bg-gradient-to-br from-violet-400/50 to-indigo-500/35 [animation-delay:5s] dark:from-violet-500/30 dark:to-indigo-600/20"></div>
          <div class="absolute left-[74%] top-20 h-12 w-12 animate-geo rounded-[30%] bg-gradient-to-br from-cyan-400/50 to-sky-500/35 [animation-delay:7.5s] dark:from-cyan-500/30 dark:to-sky-600/20"></div>
          <div class="absolute left-[14%] bottom-10 h-12 w-12 animate-geo [clip-path:polygon(0_0,100%_0,50%_100%)] bg-gradient-to-br from-blue-400/50 to-indigo-500/35 [animation-delay:4s] dark:from-blue-500/30 dark:to-indigo-600/20"></div>
          <div class="absolute left-[42%] bottom-4 h-14 w-14 animate-geo rounded-full bg-gradient-to-br from-teal-400/50 to-emerald-500/35 [animation-delay:9s] dark:from-teal-500/30 dark:to-emerald-600/20"></div>
          <div class="absolute left-[64%] bottom-14 h-12 w-12 animate-geo rounded-xl bg-gradient-to-br from-indigo-400/50 to-violet-500/35 [animation-delay:6.5s] dark:from-indigo-500/30 dark:to-violet-600/20"></div>
          <div class="absolute left-[86%] top-8 h-12 w-12 animate-geo [clip-path:polygon(50%_0,100%_100%,0_100%)] bg-gradient-to-br from-sky-400/50 to-cyan-500/35 [animation-delay:1.5s] dark:from-sky-500/30 dark:to-cyan-600/20"></div>
        </div>
      </aside>

      <!-- 右：应用窗口（固定视口高，内容区内滚，底部标签栏常驻） -->
      <section class="glass-card flex h-[calc(100dvh-1rem)] flex-1 flex-col overflow-hidden rounded-3xl sm:h-[calc(100dvh-2rem)] sm:rounded-[2rem]">
        <!-- 标题栏 -->
        <header class="flex h-14 shrink-0 items-center justify-between border-b border-gray-100/80 bg-white/60 px-4 backdrop-blur-xl dark:border-gray-800/50 dark:bg-gray-900/60 sm:h-16 sm:px-6">
          <div class="flex items-center gap-2.5 sm:gap-3">
            <div class="relative flex h-8 w-8 items-center justify-center rounded-xl brand-gradient text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20 sm:h-9 sm:w-9">
              <Cloud class="h-4 w-4 sm:h-5 sm:w-5" :stroke-width="2.5" />
              <div class="absolute inset-0 rounded-xl bg-gradient-to-t from-black/10 to-transparent"></div>
            </div>
            <span class="text-lg font-bold tracking-tight text-gray-900 dark:text-white sm:text-xl">{{ pageTitle }}</span>
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
              <span class="relative ml-1.5 hidden font-medium sm:inline">退出</span>
            </button>
          </div>
        </header>

        <!-- 内容区：桌面端左侧垂直侧栏；平板/手机自动切换为底部标签栏 -->
        <div class="flex min-h-0 flex-1">
          <!-- 桌面垂直侧栏（仅 >=1024px） -->
          <nav class="hidden w-52 shrink-0 flex-col gap-1.5 border-r border-gray-100/80 bg-white/40 p-4 backdrop-blur lg:flex dark:border-gray-800/50 dark:bg-gray-900/40">
            <RouterLink
              v-for="item in menu"
              :key="item.label"
              :to="item.to"
              :aria-current="item.active ? 'page' : undefined"
              class="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all"
              :class="
                item.active
                  ? 'bg-gradient-to-r from-blue-500/15 to-sky-400/10 text-blue-700 ring-1 ring-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30'
                  : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100'
              "
            >
              <component
                :is="item.icon"
                class="h-[18px] w-[18px]"
                :class="item.active ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300'"
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
            :key="item.label"
            :to="item.to"
            :aria-current="item.active ? 'page' : undefined"
            class="flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            :class="
              item.active
                ? 'text-blue-600 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            "
          >
            <!-- 激活态：图标背后的 pill 高亮，与桌面侧栏选中样式呼应 -->
            <span
              class="flex h-8 w-16 items-center justify-center rounded-full transition-colors"
              :class="item.active ? 'bg-blue-500/15 dark:bg-blue-400/15' : ''"
            >
              <component :is="item.icon" class="h-6 w-6" :stroke-width="item.active ? 2.5 : 2" />
            </span>
            <span class="text-[11px] font-medium">{{ item.label }}</span>
          </RouterLink>
        </nav>
      </section>
    </div>
  </div>
</template>
