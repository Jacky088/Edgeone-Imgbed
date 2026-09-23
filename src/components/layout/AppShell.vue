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
import BucketBadge from '@/components/BucketBadge.vue'
import { useUploadSettings } from '@/composables/useUploadSettings'
import { formatCompactSize } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const { settings } = useUploadSettings()

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

const props = defineProps<{
  /** 全站图片统计（首页拉取后传入；其他页面不需要时可不传，存储卡降级为仅显示配额） */
  stats?: { count: number; totalSize: number; trashed: number } | null
}>()

// header 展示当前页面标题（大屏左侧品牌区已有站名，避免重复）
const pageTitle = computed(() => {
  if (route.name === 'admin' && route.query.view === 'trash') return '回收站'
  return menu.value.find((item) => item.active)?.label || 'Edgeone-Imgbed'
})

// 侧栏存储卡：已用 / 配额占比（以 useUploadSettings.storageQuotaGB 为总额基准）
const usedBytes = computed(() => props.stats?.totalSize ?? 0)
const quotaBytes = computed(() => settings.value.storageQuotaGB * 1024 * 1024 * 1024)
const quotaPct = computed(() =>
  quotaBytes.value > 0 ? Math.min(100, Math.round((usedBytes.value / quotaBytes.value) * 100)) : 0,
)

const handleLogout = () => {
  sessionStorage.removeItem('site_access_token')
  localStorage.removeItem('site_access_token')
  router.push('/login')
}
</script>

<template>
  <div class="app-bg relative min-h-dvh w-full overflow-x-hidden transition-colors duration-500">
    <div class="mx-auto flex min-h-dvh max-w-[1600px] gap-6 p-3 sm:p-5 lg:p-6">
      <!-- 左：导航侧栏卡片（桌面端常驻；窗口化窄屏与移动端收起为底部标签栏） -->
      <aside class="hidden w-60 shrink-0 flex-col gap-5 lg:flex xl:w-64">
        <!-- 品牌 -->
        <div class="flex items-center gap-3 px-2 pt-2">
          <div class="relative flex h-11 w-11 items-center justify-center rounded-2xl brand-gradient text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
            <Cloud class="h-6 w-6" :stroke-width="2.5" />
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/10 to-transparent"></div>
          </div>
          <h1 class="text-xl font-black tracking-tight text-gray-900 dark:text-white">
            Edgeone-Imgbed
          </h1>
        </div>

        <!-- 导航 -->
        <nav class="card flex flex-col gap-1 p-3">
          <RouterLink
            v-for="item in menu"
            :key="item.label"
            :to="item.to"
            :aria-current="item.active ? 'page' : undefined"
            class="group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
            :class="
              item.active
                ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100'
            "
          >
            <component
              :is="item.icon"
              class="h-[18px] w-[18px]"
              :class="item.active ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300'"
            />
            {{ item.label }}
            <span
              v-if="item.active"
              class="ml-auto h-5 w-1 rounded-full bg-indigo-500 dark:bg-indigo-400"
            />
          </RouterLink>
        </nav>

        <!-- 插画卡：纯 CSS 云朵 + 浮动图片徽章，呼应品牌 -->
        <div class="card relative overflow-hidden p-5 text-center">
          <div class="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-100/60 blur-2xl dark:bg-indigo-500/10" />
          <div class="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-violet-100/60 blur-2xl dark:bg-violet-500/10" />
          <div class="relative mx-auto mb-3 h-28">
            <div class="absolute bottom-1 left-1/2 h-10 w-36 -translate-x-1/2 rounded-full bg-indigo-100/80 blur-[2px] dark:bg-indigo-500/20" />
            <div class="absolute bottom-4 left-1/2 h-14 w-28 -translate-x-1/2 rounded-3xl bg-gradient-to-br from-indigo-100 to-sky-100 shadow-sm dark:from-indigo-900/50 dark:to-sky-900/40" />
            <div class="absolute bottom-10 left-[18%] h-9 w-9 rounded-full bg-gradient-to-br from-indigo-100 to-sky-100 shadow-sm dark:from-indigo-900/50 dark:to-sky-900/40" />
            <div class="absolute bottom-8 right-[16%] h-7 w-7 rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 shadow-sm dark:from-violet-900/50 dark:to-indigo-900/40" />
            <div class="absolute bottom-9 left-1/2 flex h-14 w-14 -translate-x-1/2 animate-bob items-center justify-center rounded-2xl bg-white text-indigo-500 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-100 dark:bg-gray-800 dark:text-indigo-300 dark:ring-gray-700">
              <Cloud class="h-7 w-7" />
            </div>
          </div>
          <p class="relative text-sm font-semibold leading-relaxed text-indigo-600 dark:text-indigo-300">
            基于 EO 和 CNB 对象存储<br />的简易图床服务
          </p>
          <div class="relative mt-3 flex flex-wrap items-center justify-center gap-1.5">
            <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <span class="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-blue-500 to-sky-400 text-[8px] font-black text-white">EO</span>
              EdgeOne
            </span>
            <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <span class="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-emerald-400 to-teal-500 text-[8px] font-black text-white">CB</span>
              CloudBase
            </span>
            <a
              href="https://github.com/Jacky088/Edgeone-Imgbed"
              target="_blank"
              rel="noopener noreferrer"
              title="在 GitHub 上查看项目"
              class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-900 hover:text-white dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white dark:hover:text-gray-900"
            >
              <Github class="h-3 w-3" />
              GitHub
            </a>
          </div>
        </div>

        <!-- 存储卡 -->
        <div class="card mt-auto p-5">
          <div class="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <Cloud class="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            存储空间
          </div>
          <p class="mt-2 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
            {{ stats ? `${formatCompactSize(usedBytes)} / ${settings.storageQuotaGB} GB` : `配额 ${settings.storageQuotaGB} GB` }}
          </p>
          <div class="mt-2.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="progressbar" :aria-valuenow="quotaPct" aria-valuemin="0" aria-valuemax="100" :aria-label="`存储已用 ${quotaPct}%`">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              :style="{ width: `${quotaPct}%` }"
            />
          </div>
          <p class="mt-1.5 text-right text-[11px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
            {{ quotaPct }}%
          </p>
        </div>
      </aside>

      <!-- 右：主区域 -->
      <div class="flex min-w-0 flex-1 flex-col gap-4 sm:gap-5">
        <!-- 顶栏 -->
        <header class="card flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:h-16 sm:px-5">
          <div class="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <!-- 窄屏品牌（侧栏隐藏时露出） -->
            <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl brand-gradient text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 lg:hidden">
              <Cloud class="h-5 w-5" :stroke-width="2.5" />
            </div>
            <span class="truncate text-base font-bold tracking-tight text-gray-900 dark:text-white sm:text-lg">{{ pageTitle }}</span>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <BucketBadge />
            <ThemeToggle compact />
            <button
              @click="handleLogout"
              class="group relative flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition-all hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 sm:w-auto sm:px-3 sm:text-sm sm:font-medium"
              title="退出登录"
            >
              <span class="absolute inset-0 rounded-xl bg-red-50 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-red-900/10"></span>
              <LogOut class="relative h-4 w-4" />
              <span class="relative ml-1.5 hidden font-medium md:inline">退出</span>
            </button>
          </div>
        </header>

        <!-- 主内容（自然页面滚动；窗口化/移动端都不再锁死视口高） -->
        <main class="min-w-0 flex-1 pb-24 lg:pb-8">
          <slot />
        </main>

        <!-- 移动 / 窄窗口底部标签栏（<1024px），大触控目标 + 安全区 -->
        <nav class="card fixed inset-x-3 bottom-3 z-40 flex shrink-0 items-stretch lg:hidden" style="padding-bottom: env(safe-area-inset-bottom)">
          <RouterLink
            v-for="item in menu"
            :key="item.label"
            :to="item.to"
            :aria-current="item.active ? 'page' : undefined"
            class="flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            :class="
              item.active
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            "
          >
            <span
              class="flex h-8 w-16 items-center justify-center rounded-full transition-colors"
              :class="item.active ? 'bg-indigo-500/15 dark:bg-indigo-400/15' : ''"
            >
              <component :is="item.icon" class="h-6 w-6" :stroke-width="item.active ? 2.5 : 2" />
            </span>
            <span class="text-[11px] font-medium">{{ item.label }}</span>
          </RouterLink>
        </nav>
      </div>
    </div>
  </div>
</template>
