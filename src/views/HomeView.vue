<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, Settings, LogOut, Copy, Image as ImageIcon, Link as LinkIcon, Server } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { toast } from 'vue-sonner'

const router = useRouter()

// 批量上传：逐张收集上传结果
interface UploadResult {
  url: string
  thumbnailUrl?: string
  urlOriginal?: string
  thumbnailOriginalUrl?: string
  name?: string
}

const results = ref<UploadResult[]>([])

const handleUploadSuccess = (info: UploadResult) => {
  results.value.push(info)
}

const handleLogout = () => {
  sessionStorage.removeItem('site_access_token')
  router.push('/login')
}

const copyToClipboard = async (text: string | undefined) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('复制成功！')
  } catch (err) {
    console.error(err)
    toast.error('复制失败，请尝试手动选中复制')
  }
}
</script>

<template>
  <div class="aurora-bg relative min-h-screen w-full overflow-x-hidden transition-colors duration-500">

    <!-- 精致导航栏 -->
    <header class="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-white/70 backdrop-blur-xl dark:border-white/5 dark:bg-gray-950/70">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-3">
          <div class="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20">
            <Upload class="h-5 w-5" :stroke-width="2.5" />
            <div class="absolute inset-0 rounded-xl bg-gradient-to-t from-black/10 to-transparent"></div>
          </div>
          <span class="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-white dark:via-gray-200 dark:to-white">
            CNB 图床
          </span>
        </div>

        <div class="flex items-center gap-2">
          <ThemeToggle />
          <div class="h-4 w-px bg-gray-200/50 dark:bg-gray-700/50"></div>
          <button
            @click="router.push('/admin')"
            class="group relative flex h-9 items-center justify-center overflow-hidden rounded-xl px-3 text-sm font-medium text-gray-600 transition-all hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 sm:gap-2 sm:px-4"
            title="管理后台"
          >
            <div class="absolute inset-0 bg-gray-100 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-800/50"></div>
            <Settings class="relative h-4 w-4" />
            <span class="relative hidden sm:block">后台</span>
          </button>
          <button
            @click="handleLogout"
            class="group relative flex h-9 items-center justify-center overflow-hidden rounded-xl px-3 text-sm font-medium text-gray-600 transition-all hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 sm:gap-2 sm:px-4"
            title="退出登录"
          >
            <div class="absolute inset-0 bg-red-50 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-red-900/10"></div>
            <LogOut class="relative h-4 w-4" />
            <span class="relative hidden sm:block">注销</span>
          </button>
        </div>
      </div>
    </header>

    <main class="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-24 sm:px-6">

      <!-- 精致标题区 -->
      <div class="mb-12 text-center">
        <h1 class="mb-5 bg-gradient-to-r from-gray-900 via-blue-700 to-purple-700 bg-clip-text text-5xl font-black tracking-tight text-transparent dark:from-white dark:via-blue-300 dark:to-purple-300 sm:text-6xl">
          CNB 图床，云端存储
        </h1>
        <p class="text-lg font-light text-gray-600 dark:text-gray-400 sm:text-xl">
          基于 <span class="font-medium text-gray-800 dark:text-gray-300">Serverless</span> 构建，自动压缩，全球 CDN 加速
        </p>
      </div>

      <div class="w-full max-w-5xl space-y-10">

        <!-- 上传组件 - 更精致的卡片 -->
        <div class="glass-card-premium mx-auto max-w-2xl overflow-hidden rounded-3xl p-8 shadow-2xl shadow-blue-500/5 ring-1 ring-white/20 dark:shadow-blue-500/10 dark:ring-white/5">
          <FileUploader
            @update:uploadInfo="handleUploadSuccess"
            :maxHeight="5000"
            :maxWidth="5000"
            :quality="0.7"
            :generateThumbnail="true"
            :thumbnailMaxWidth="400"
            :thumbnailMaxHeight="800"
            :thumbnailQuality="0.8"
          />
        </div>

        <Transition
          enter-active-class="transition-all duration-700 ease-out"
          enter-from-class="opacity-0 translate-y-12 scale-95"
          enter-to-class="opacity-100 translate-y-0 scale-100"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 translate-y-0 scale-100"
          leave-to-class="opacity-0 translate-y-8 scale-95"
        >
          <div v-if="results.length" class="space-y-10">
          <div v-for="(info, idx) in results" :key="idx" class="glass-card-premium overflow-hidden rounded-3xl shadow-2xl shadow-blue-500/5 ring-1 ring-white/20 dark:shadow-blue-500/10 dark:ring-white/5">
            <!-- 精致头部 -->
            <div class="relative flex items-center gap-3 border-b border-gray-100/80 bg-gradient-to-r from-white/80 via-white/60 to-white/80 px-6 py-5 backdrop-blur-sm dark:border-gray-800/50 dark:from-gray-900/80 dark:via-gray-900/60 dark:to-gray-900/80">
              <div class="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-lg shadow-green-500/30">
                <div class="h-3.5 w-3.5 animate-pulse rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]"></div>
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-lg font-bold text-gray-900 dark:text-white">上传成功<span v-if="results.length > 1" class="ml-1.5 text-sm font-medium text-gray-400">({{ idx + 1 }}/{{ results.length }})</span></h3>
                <p class="truncate text-xs text-gray-500 dark:text-gray-400" :title="info.name">{{ info.name || '图片已处理并上传至云端' }}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-10 p-8 lg:grid-cols-12 lg:p-10">

              <!-- 图片预览区 - 更精致 -->
              <div class="flex flex-col items-center justify-center gap-6 lg:col-span-5 lg:border-r lg:border-gray-100/50 lg:pr-10 lg:dark:border-gray-800/50">
                <div class="group relative aspect-square w-full max-w-[300px]">
                  <!-- 装饰性背景 -->
                  <div class="absolute -inset-4 rounded-3xl bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"></div>

                  <!-- 图片容器 -->
                  <div class="relative h-full overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-gray-50 to-gray-100 shadow-2xl ring-1 ring-gray-900/5 transition-all duration-500 group-hover:scale-[1.02] group-hover:shadow-3xl dark:border-gray-700 dark:from-gray-900 dark:to-gray-800 dark:ring-white/5">
                    <img
                      :src="info.thumbnailUrl || info.url"
                      class="h-full w-full object-cover"
                      alt="Uploaded Preview"
                      @error="(e) => {
                        console.error('图片加载失败，尝试备用链接');
                        const img = e.target as HTMLImageElement;
                        if (img.src === info.thumbnailUrl) {
                          img.src = info.url || '';
                        } else if (img.src === info.url) {
                          img.src = info.urlOriginal || '';
                        }
                      }"
                    />
                    <!-- 悬浮遮罩 -->
                    <div class="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <a :href="info.url" target="_blank" class="translate-y-6 transition-all duration-300 group-hover:translate-y-0">
                        <div class="flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 shadow-2xl ring-1 ring-gray-900/5 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white/95">
                          <ImageIcon class="h-4 w-4" />
                          查看原图
                        </div>
                      </a>
                    </div>
                  </div>
                </div>
                <p class="text-xs font-medium text-gray-400 dark:text-gray-500">点击查看完整尺寸</p>
              </div>

              <!-- 链接区 - 更精致 -->
              <div class="flex flex-col justify-center space-y-8 lg:col-span-7">

                <!-- CDN 链接组 -->
                <div class="space-y-4">
                  <div class="flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                      <Server class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h4 class="text-sm font-bold text-gray-900 dark:text-white">
                      CDN 加速链接
                    </h4>
                    <span class="rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">推荐</span>
                  </div>

                  <!-- 主链接 -->
                  <div class="group relative">
                    <div class="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400">
                      <LinkIcon class="h-4 w-4" />
                    </div>
                    <div
                      @click="copyToClipboard(info.url)"
                      class="flex min-h-[3.25rem] cursor-pointer items-center overflow-hidden rounded-xl bg-gradient-to-r from-gray-50 to-gray-50/50 py-3.5 pl-12 pr-14 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-all hover:from-blue-50 hover:to-blue-50/50 hover:text-blue-700 hover:ring-blue-300 hover:shadow-md active:scale-[0.99] dark:from-gray-900 dark:to-gray-900/50 dark:text-gray-200 dark:ring-gray-800 dark:hover:from-blue-900/30 dark:hover:to-blue-900/20 dark:hover:text-blue-300 dark:hover:ring-blue-700"
                    >
                      <div class="truncate">{{ info.url }}</div>
                    </div>
                    <button
                      @click="copyToClipboard(info.url)"
                      class="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-white hover:text-blue-600 hover:shadow-sm dark:hover:bg-gray-800 dark:hover:text-blue-400"
                    >
                      <Copy class="h-4 w-4" />
                    </button>
                  </div>

                  <!-- 缩略图链接 -->
                  <div v-if="info.thumbnailUrl" class="group relative">
                    <div class="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400">
                      <ImageIcon class="h-4 w-4" />
                    </div>
                    <div
                      @click="copyToClipboard(info.thumbnailUrl)"
                      class="flex min-h-[3.25rem] cursor-pointer items-center overflow-hidden rounded-xl bg-gradient-to-r from-gray-50 to-gray-50/50 py-3.5 pl-12 pr-14 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-all hover:from-purple-50 hover:to-purple-50/50 hover:text-purple-700 hover:ring-purple-300 hover:shadow-md active:scale-[0.99] dark:from-gray-900 dark:to-gray-900/50 dark:text-gray-200 dark:ring-gray-800 dark:hover:from-purple-900/30 dark:hover:to-purple-900/20 dark:hover:text-purple-300 dark:hover:ring-purple-700"
                    >
                      <div class="truncate">{{ info.thumbnailUrl }}</div>
                    </div>
                    <button
                      @click="copyToClipboard(info.thumbnailUrl)"
                      class="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-white hover:text-purple-600 hover:shadow-sm dark:hover:bg-gray-800 dark:hover:text-purple-400"
                    >
                      <Copy class="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <!-- 源站链接组 -->
                <div class="space-y-3 rounded-xl bg-gray-50/50 p-4 dark:bg-gray-900/30">
                  <h4 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <div class="h-1 w-1 rounded-full bg-gray-400"></div>
                    源站直连 (备用)
                  </h4>

                  <div
                    @click="copyToClipboard(info.urlOriginal)"
                    class="group flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200/60 bg-white/50 px-4 py-2.5 text-xs text-gray-600 transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:border-gray-700/50 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <span class="truncate font-mono">{{ info.urlOriginal }}</span>
                    <Copy class="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div
                    v-if="info.thumbnailOriginalUrl"
                    @click="copyToClipboard(info.thumbnailOriginalUrl)"
                    class="group flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200/60 bg-white/50 px-4 py-2.5 text-xs text-gray-600 transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900 hover:shadow-sm dark:border-gray-700/50 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <span class="truncate font-mono">{{ info.thumbnailOriginalUrl }}</span>
                    <Copy class="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>

              </div>
            </div>
          </div>
          </div>
        </Transition>

      </div>
    </main>

    <footer class="relative z-10 py-8 text-center text-sm text-gray-400 dark:text-gray-600">
      <p>© {{ new Date().getFullYear() }} CNB 图床. Serverless Power.</p>
    </footer>
  </div>
</template>
