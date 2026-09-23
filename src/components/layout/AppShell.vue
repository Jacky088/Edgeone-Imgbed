<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed, onMounted } from 'vue'
import {
  CloudUpload,
  GalleryVertical,
  Settings,
  Info,
  LogOut,
  Cloud,
  Github,
  Archive,
  Link2,
  Database,
} from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import BucketBadge from '@/components/BucketBadge.vue'
import { useUploadSettings } from '@/composables/useUploadSettings'
import { useGlobalStats } from '@/composables/useGlobalStats'
import { useBucket } from '@/composables/useBucket'
import { formatCompactSize } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const { settings } = useUploadSettings()
// 全站统计与桶名由 AppShell 统一拉取：所有页面侧栏/顶栏一致，无需各页面传入
const { stats, fetchStats } = useGlobalStats()
const { fetchBucket } = useBucket()
onMounted(() => {
  fetchStats()
  fetchBucket()
})

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
  return menu.value.find((item) => item.active)?.label || 'CNB图床'
})

// 侧栏存储卡：已用 / 配额占比（以 useUploadSettings.storageQuotaGB 为总额基准）
const usedBytes = computed(() => stats.value?.totalSize ?? 0)
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
      <!-- 左：导航侧栏卡片（桌面端常驻；窗口化窄屏与移动端收起为底部标签栏）
           卡片自然堆叠（品牌 / 导航 / 插画 / 存储），存储卡紧跟插画卡，不留空白 -->
      <aside class="hidden w-60 shrink-0 self-start flex-col gap-5 lg:flex xl:w-64">
        <!-- 品牌 -->
        <div class="flex items-center gap-3 px-2 pt-2">
          <div class="relative flex h-11 w-11 items-center justify-center rounded-2xl brand-gradient text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
            <Cloud class="h-6 w-6" :stroke-width="2.5" />
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/10 to-transparent"></div>
          </div>
          <h1 class="text-xl font-black tracking-tight text-gray-900 dark:text-white">
            CNB图床
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

        <!-- 插画卡：与目标图一致的云朵 + 浮动图片徽章 + 文案 + 徽章 -->
        <div class="card relative overflow-hidden p-5 text-center">
          <div class="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-100/60 blur-2xl dark:bg-indigo-500/10" />
          <div class="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-violet-100/60 blur-2xl dark:bg-violet-500/10" />
          <!-- 插画区：云朵 + 三张浮动照片 + 基座（对标目标图） -->
          <div class="relative mx-auto mb-2 h-40 select-none" aria-hidden="true">
            <!-- 星光 -->
            <div class="absolute left-[9%] top-1.5 h-2 w-2 rotate-45 rounded-[2px] bg-indigo-200 dark:bg-indigo-500/50" />
            <div class="absolute right-[15%] top-0 h-1.5 w-1.5 rotate-45 rounded-[1px] bg-violet-200 dark:bg-violet-500/50" />
            <!-- 主云朵 -->
            <div class="absolute left-1/2 top-2 h-12 w-32 -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-200 via-indigo-100 to-violet-200/80 dark:from-indigo-500/40 dark:via-indigo-500/25 dark:to-violet-500/25" />
            <div class="absolute left-1/2 top-0.5 h-9 w-9 -translate-x-[54px] rounded-full bg-indigo-200 dark:bg-indigo-500/40" />
            <div class="absolute left-1/2 top-1.5 h-7 w-7 translate-x-[32px] rounded-full bg-violet-200/90 dark:bg-violet-500/30" />
            <!-- 右上链接徽标 -->
            <div class="absolute right-[3%] top-7 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-indigo-100 dark:bg-gray-800 dark:ring-gray-700">
              <Link2 class="h-4 w-4 text-indigo-400 dark:text-indigo-300" />
            </div>
            <!-- 左侧小方块 -->
            <div class="absolute left-[1%] top-[44px] h-4 w-4 rotate-12 rounded-[5px] bg-indigo-200/90 shadow-sm dark:bg-indigo-500/30" />
            <!-- 左照片 -->
            <div class="absolute bottom-10 left-[3%] w-[52px] -rotate-[8deg] rounded-md bg-white p-[3px] shadow-md ring-1 ring-indigo-100 dark:bg-gray-700 dark:ring-gray-600">
              <svg viewBox="0 0 48 56" class="block h-[48px] w-full rounded-[4px]" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="sd-a" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#c7d2fe" />
                    <stop offset="1" stop-color="#f5f3ff" />
                  </linearGradient>
                </defs>
                <rect width="48" height="56" fill="url(#sd-a)" />
                <circle cx="35" cy="13" r="6" fill="#ffffff" opacity="0.95" />
                <polygon points="0,42 15,20 29,42" fill="#a5b4fc" />
                <polygon points="17,42 33,22 48,42" fill="#818cf8" />
                <polygon points="0,42 48,42 48,56 0,56" fill="#6366f1" opacity="0.35" />
              </svg>
            </div>
            <!-- 中照片 -->
            <div class="absolute bottom-8 left-1/2 w-16 -translate-x-1/2 rounded-md bg-white p-[3px] shadow-lg ring-1 ring-indigo-100 dark:bg-gray-700 dark:ring-gray-600">
              <svg viewBox="0 0 56 64" class="block h-[58px] w-full rounded-[4px]" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="sd-b" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#ddd6fe" />
                    <stop offset="1" stop-color="#faf5ff" />
                  </linearGradient>
                </defs>
                <rect width="56" height="64" fill="url(#sd-b)" />
                <circle cx="18" cy="16" r="7" fill="#ffffff" opacity="0.95" />
                <polygon points="0,48 18,22 36,48" fill="#8b7cf6" />
                <polygon points="22,48 40,26 58,48" fill="#7c6cf2" />
                <polygon points="0,48 56,48 56,64 0,64" fill="#6d5ef0" opacity="0.3" />
              </svg>
            </div>
            <!-- 右照片 -->
            <div class="absolute bottom-10 right-[3%] w-[52px] rotate-[8deg] rounded-md bg-white p-[3px] shadow-md ring-1 ring-indigo-100 dark:bg-gray-700 dark:ring-gray-600">
              <svg viewBox="0 0 48 56" class="block h-[48px] w-full rounded-[4px]" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="sd-c" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#bae6fd" />
                    <stop offset="1" stop-color="#eef2ff" />
                  </linearGradient>
                </defs>
                <rect width="48" height="56" fill="url(#sd-c)" />
                <circle cx="13" cy="14" r="5" fill="#ffffff" opacity="0.95" />
                <polygon points="0,42 16,22 30,42" fill="#7dd3fc" />
                <polygon points="18,42 33,24 48,42" fill="#60a5fa" />
                <polygon points="0,42 48,42 48,56 0,56" fill="#4f8dfd" opacity="0.3" />
              </svg>
            </div>
            <!-- 基座 -->
            <div class="absolute bottom-0.5 left-1/2 h-6 w-36 -translate-x-1/2 rounded-[50%] bg-indigo-100 dark:bg-indigo-500/20" />
            <div class="absolute bottom-1.5 left-1/2 h-[18px] w-28 -translate-x-1/2 rounded-[50%] bg-indigo-200/70 dark:bg-indigo-500/25" />
            <div class="absolute bottom-2.5 left-1/2 h-2.5 w-16 -translate-x-1/2 rounded-[50%] bg-white shadow-[0_0_14px_rgba(129,140,248,0.9)] dark:bg-indigo-300/70" />
          </div>
          <p class="relative text-sm font-semibold leading-relaxed text-indigo-600 dark:text-indigo-300">
            基于 EO 和 CNB 对象存储<br />的简易图床服务
          </p>
          <div class="relative mt-3 flex items-center justify-center">
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

        <!-- 存储卡：与目标图一致的图标 + 数字 + 进度条 + 百分比 -->
        <div class="card p-5">
          <div class="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <Database class="h-4 w-4 text-gray-400 dark:text-gray-500" />
            存储空间
          </div>
          <p class="mt-1.5 text-center text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
            <template v-if="stats">{{ formatCompactSize(usedBytes) }} <span class="font-semibold text-gray-400 dark:text-gray-500">/ {{ settings.storageQuotaGB }} GB</span></template>
            <template v-else>配额 {{ settings.storageQuotaGB }} GB</template>
          </p>
          <div class="mt-2 h-[7px] overflow-hidden rounded-full bg-indigo-50 dark:bg-gray-800" role="progressbar" :aria-valuenow="quotaPct" aria-valuemin="0" aria-valuemax="100" :aria-label="`存储已用 ${quotaPct}%`">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              :style="{ width: `${quotaPct}%` }"
            />
          </div>
          <p class="mt-1 text-right text-[11px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
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
