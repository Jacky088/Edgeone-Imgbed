<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, Settings, LogOut, Copy, Check } from 'lucide-vue-next' // [新增] 引入 Copy 图标
import ThemeToggle from '@/components/ThemeToggle.vue'
import { toast } from 'vue-sonner' // [引用] 引入 toast

const router = useRouter()

const uploadInfo = ref<{
  url: string
  thumbnailUrl?: string
  urlOriginal?: string
  thumbnailOriginalUrl?: string
} | null>(null)

const handleLogout = () => {
  sessionStorage.removeItem('site_access_token')
  router.push('/login')
}

// [新增] 复制功能函数
const copyToClipboard = async (text: string | undefined) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('复制成功！')
  } catch (err) {
    toast.error('复制失败，请手动复制')
  }
}
</script>

<template>
  <div class="relative min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 transition-colors duration-300">
    
    <div class="absolute right-6 top-6 flex items-center gap-2">
      <ThemeToggle />
      <div class="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
      <button
        @click="router.push('/admin')"
        class="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:border-gray-200 hover:bg-white hover:text-blue-600 hover:shadow-sm active:scale-95 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-blue-400"
        title="进入管理后台"
      >
        <Settings class="h-4 w-4" />
        <span>管理后台</span>
      </button>
      <button
        @click="handleLogout"
        class="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:border-red-100 hover:bg-red-50 hover:text-red-600 active:scale-95 dark:text-gray-400 dark:hover:border-red-900/30 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        title="退出登录"
      >
        <LogOut class="h-4 w-4" />
        <span>注销</span>
      </button>
    </div>

    <div class="flex min-h-[calc(100vh-4px)] flex-col items-center justify-center px-4 py-12">
      <div class="mb-8 text-center">
        <div class="mb-4 flex items-center justify-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/30">
            <Upload class="h-6 w-6" :stroke-width="2.5" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">图片上传</h1>
        </div>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">支持拖拽上传 • 自动压缩 • 生成缩略图</p>
      </div>

      <div class="w-full max-w-lg">
        <FileUploader
          v-model:uploadInfo="uploadInfo"
          belongTo="mindmap"
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
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-4"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-4"
      >
        <div
          v-if="uploadInfo"
          class="mt-8 w-full max-w-lg overflow-hidden rounded-2xl border border-gray-100 bg-white/80 shadow-sm backdrop-blur-sm transition-colors dark:border-gray-800 dark:bg-gray-900/80"
        >
          <div
            class="border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 dark:border-gray-800 dark:from-green-900/20 dark:to-emerald-900/20"
          >
            <div class="flex items-center gap-2">
              <div class="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-200">上传完成</h3>
            </div>
          </div>
          
          <div class="space-y-4 p-6">
            
            <div class="group">
              <div class="mb-1.5 flex items-center justify-between">
                <p class="flex items-center text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  代理原图链接
                  <span class="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">CDN加速</span>
                </p>
                <span class="text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">点击复制</span>
              </div>
              <div 
                @click="copyToClipboard(uploadInfo.url)"
                class="relative cursor-pointer rounded-md border border-gray-100 bg-gray-50 p-3 font-mono text-sm text-gray-600 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm active:scale-[0.99] dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-900/50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
              >
                <div class="break-all pr-6">{{ uploadInfo.url }}</div>
                <Copy class="absolute right-2 top-3 h-4 w-4 text-gray-400 opacity-50 dark:text-gray-500" />
              </div>
            </div>
            
            <div v-if="uploadInfo.thumbnailUrl" class="group">
              <div class="mb-1.5 flex items-center justify-between">
                <p class="flex items-center text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  代理缩略图链接
                  <span class="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">CDN加速</span>
                </p>
                <span class="text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">点击复制</span>
              </div>
              <div 
                @click="copyToClipboard(uploadInfo.thumbnailUrl)"
                class="relative cursor-pointer rounded-md border border-gray-100 bg-gray-50 p-3 font-mono text-sm text-gray-600 transition-all hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 hover:shadow-sm active:scale-[0.99] dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-purple-900/50 dark:hover:bg-purple-900/20 dark:hover:text-purple-400"
              >
                <div class="break-all pr-6">{{ uploadInfo.thumbnailUrl }}</div>
                <Copy class="absolute right-2 top-3 h-4 w-4 text-gray-400 opacity-50 dark:text-gray-500" />
              </div>
            </div>

            <div class="border-t border-dashed border-gray-100 pt-4 space-y-4 dark:border-gray-800">
              <div class="group">
                <p class="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">CNB原图链接</p>
                <div
                  @click="copyToClipboard(uploadInfo.urlOriginal)"
                  class="cursor-pointer break-all text-xs text-gray-500 transition-colors hover:text-gray-900 active:text-blue-600 dark:text-gray-400 dark:hover:text-gray-200"
                  title="点击复制"
                >
                  {{ uploadInfo.urlOriginal }}
                </div>
              </div>
              
              <div v-if="uploadInfo.thumbnailOriginalUrl" class="group">
                <p class="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">CNB缩略图链接</p>
                <div
                  @click="copyToClipboard(uploadInfo.thumbnailOriginalUrl)"
                  class="cursor-pointer break-all text-xs text-gray-500 transition-colors hover:text-gray-900 active:text-blue-600 dark:text-gray-400 dark:hover:text-gray-200"
                  title="点击复制"
                >
                  {{ uploadInfo.thumbnailOriginalUrl }}
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
