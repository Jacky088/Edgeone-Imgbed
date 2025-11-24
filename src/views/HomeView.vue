<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, Settings, LogOut, Copy, Image as ImageIcon, Link as LinkIcon, Server } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { toast } from 'vue-sonner'

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
    
    <header class="fixed top-0 left-0 right-0 z-50 border-b border-white/20 bg-white/60 backdrop-blur-md dark:border-gray-800/50 dark:bg-gray-950/60">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg">
            <Upload class="h-5 w-5" :stroke-width="2.5" />
          </div>
          <span class="bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-lg font-bold text-transparent dark:from-white dark:to-gray-400">
            ImgBed
          </span>
        </div>

        <div class="flex items-center gap-3">
          <ThemeToggle />
          <div class="h-5 w-px bg-gray-200 dark:bg-gray-700"></div>
          <button
            @click="router.push('/admin')"
            class="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-all hover:bg-gray-100 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400 sm:w-auto sm:gap-2 sm:rounded-lg sm:px-3"
            title="管理后台"
          >
            <Settings class="h-5 w-5" />
            <span class="hidden text-sm font-medium sm:block">后台</span>
          </button>
          <button
            @click="handleLogout"
            class="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-all hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 sm:w-auto sm:gap-2 sm:rounded-lg sm:px-3"
            title="退出登录"
          >
            <LogOut class="h-5 w-5" />
            <span class="hidden text-sm font-medium sm:block">注销</span>
          </button>
        </div>
      </div>
    </header>

    <main class="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-24 sm:px-6">
      
      <div class="mb-10 text-center">
        <h1 class="mb-4 bg-gradient-to-r from-gray-900 via-blue-800 to-gray-900 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent dark:from-white dark:via-blue-200 dark:to-gray-300 sm:text-5xl">
          极速图床，云端存储
        </h1>
        <p class="text-lg text-gray-600 dark:text-gray-400">
          基于 Serverless 构建，自动压缩，全球 CDN 加速
        </p>
      </div>

      <div class="w-full max-w-5xl space-y-8">
        
        <div class="glass-card mx-auto max-w-2xl rounded-[2rem] p-2 sm:p-8">
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
          enter-active-class="transition-all duration-500 ease-out"
          enter-from-class="opacity-0 translate-y-8 scale-95"
          enter-to-class="opacity-100 translate-y-0 scale-100"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 translate-y-0 scale-100"
          leave-to-class="opacity-0 translate-y-8 scale-95"
        >
          <div v-if="uploadInfo" class="glass-card overflow-hidden rounded-[2rem]">
            <div class="flex items-center gap-3 border-b border-gray-100 bg-white/50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/50">
              <div class="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                <div class="h-3 w-3 rounded-full bg-current shadow-[0_0_10px_currentColor]"></div>
              </div>
              <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">上传完成</h3>
            </div>

            <div class="grid grid-cols-1 gap-8 p-6 lg:grid-cols-12 lg:p-8">
              
              <div class="flex flex-col items-center justify-center gap-4 lg:col-span-4 lg:border-r lg:border-gray-100 lg:pr-8 lg:dark:border-gray-800">
                <div class="group relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border-4 border-white bg-gray-100 shadow-2xl transition-transform hover:scale-105 dark:border-gray-800 dark:bg-gray-900">
                  <img 
                    :src="uploadInfo.thumbnailUrl || uploadInfo.url" 
                    class="h-full w-full object-cover" 
                    alt="Uploaded Preview"
                  />
                  <div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                    <a :href="uploadInfo.url" target="_blank" class="translate-y-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                      <div class="flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-gray-900 backdrop-blur shadow-lg hover:bg-white">
                        <ImageIcon class="h-4 w-4" />
                        查看原图
                      </div>
                    </a>
                  </div>
                </div>
                <p class="text-xs text-gray-400 dark:text-gray-500">点击图片可查看详情</p>
              </div>

              <div class="flex flex-col justify-center space-y-6 lg:col-span-8">
                
                <div class="space-y-3">
                  <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <Server class="h-4 w-4 text-blue-500" />
                    CDN 加速链接
                    <span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">推荐</span>
                  </h4>
                  
                  <div class="group relative">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <LinkIcon class="h-4 w-4" />
                    </div>
                    <div 
                      @click="copyToClipboard(uploadInfo.url)"
                      class="flex min-h-[3rem] cursor-pointer items-center overflow-hidden rounded-xl bg-gray-50 py-3 pl-10 pr-12 text-sm text-gray-600 ring-1 ring-gray-200 transition-all hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-300 active:scale-[0.99] dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 dark:hover:ring-blue-700"
                    >
                      <div class="truncate">{{ uploadInfo.url }}</div>
                    </div>
                    <button 
                      @click="copyToClipboard(uploadInfo.url)"
                      class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-blue-600 hover:shadow-sm dark:hover:bg-gray-700 dark:hover:text-blue-400"
                    >
                      <Copy class="h-4 w-4" />
                    </button>
                  </div>

                  <div v-if="uploadInfo.thumbnailUrl" class="group relative">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <ImageIcon class="h-4 w-4" />
                    </div>
                    <div 
                      @click="copyToClipboard(uploadInfo.thumbnailUrl)"
                      class="flex min-h-[3rem] cursor-pointer items-center overflow-hidden rounded-xl bg-gray-50 py-3 pl-10 pr-12 text-sm text-gray-600 ring-1 ring-gray-200 transition-all hover:bg-purple-50 hover:text-purple-700 hover:ring-purple-300 active:scale-[0.99] dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-purple-900/20 dark:hover:text-purple-400 dark:hover:ring-purple-700"
                    >
                      <div class="truncate">{{ uploadInfo.thumbnailUrl }}</div>
                    </div>
                    <button 
                      @click="copyToClipboard(uploadInfo.thumbnailUrl)"
                      class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-purple-600 hover:shadow-sm dark:hover:bg-gray-700 dark:hover:text-purple-400"
                    >
                      <Copy class="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div class="space-y-3 pt-2">
                  <h4 class="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                    源站直连 (备用)
                  </h4>
                  
                  <div 
                    @click="copyToClipboard(uploadInfo.urlOriginal)"
                    class="group flex min-h-[2.5rem] cursor-pointer items-center justify-between rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-500 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <span class="truncate">{{ uploadInfo.urlOriginal }}</span>
                    <Copy class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div 
                    v-if="uploadInfo.thumbnailOriginalUrl"
                    @click="copyToClipboard(uploadInfo.thumbnailOriginalUrl)"
                    class="group flex min-h-[2.5rem] cursor-pointer items-center justify-between rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-500 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <span class="truncate">{{ uploadInfo.thumbnailOriginalUrl }}</span>
                    <Copy class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>

              </div>
            </div>
          </div>
        </Transition>

      </div>
    </main>

    <footer class="relative z-10 py-8 text-center text-sm text-gray-400 dark:text-gray-600">
      <p>© {{ new Date().getFullYear() }} ImgBed. Serverless Power.</p>
    </footer>
  </div>
</template>
