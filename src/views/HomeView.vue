<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, Settings, LogOut } from 'lucide-vue-next'

const router = useRouter()

const uploadInfo = ref<{
  url: string
  thumbnailUrl?: string
  urlOriginal?: string
  thumbnailOriginalUrl?: string
} | null>(null)

const handleLogout = () => {
  // 清除口令验证状态
  sessionStorage.removeItem('site_access_token')
  // 返回登录页
  router.push('/login')
}
</script>

<template>
  <div class="relative min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
    
    <div class="absolute right-6 top-6 flex items-center gap-2">
      <button
        @click="router.push('/admin')"
        class="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:border-gray-200 hover:bg-white hover:text-blue-600 hover:shadow-sm active:scale-95"
        title="进入管理后台"
      >
        <Settings class="h-4 w-4" />
        <span>管理后台</span>
      </button>
      <div class="h-4 w-px bg-gray-200"></div>
      <button
        @click="handleLogout"
        class="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:border-red-100 hover:bg-red-50 hover:text-red-600 active:scale-95"
        title="退出登录"
      >
        <LogOut class="h-4 w-4" />
        <span>注销</span>
      </button>
    </div>

    <div class="flex min-h-[calc(100vh-4px)] flex-col items-center justify-center px-4 py-12">
      <div class="mb-8 text-center">
        <div class="mb-4 flex items-center justify-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200">
            <Upload class="h-6 w-6" :stroke-width="2.5" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-gray-900">图片上传</h1>
        </div>
        <p class="mt-2 text-sm text-gray-500">支持拖拽上传 • 自动压缩 • 生成缩略图</p>
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
          class="mt-8 w-full max-w-lg overflow-hidden rounded-2xl border border-gray-100 bg-white/80 shadow-sm backdrop-blur-sm"
        >
          <div
            class="border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4"
          >
            <div class="flex items-center gap-2">
              <div class="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
              <h3 class="text-sm font-medium text-gray-700">上传完成</h3>
            </div>
          </div>
          <div class="space-y-4 p-6">
            <div class="group">
              <p class="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                代理原图链接
                <span class="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">CDN加速</span>
              </p>
              <div class="relative rounded-md bg-gray-50 p-2 font-mono text-sm text-gray-600 transition-colors group-hover:bg-blue-50/50">
                <a
                  :href="uploadInfo.url"
                  target="_blank"
                  class="break-all hover:text-blue-600 hover:underline"
                >
                  {{ uploadInfo.url }}
                </a>
              </div>
            </div>
            
            <div v-if="uploadInfo.thumbnailUrl" class="group">
              <p class="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                代理缩略图链接
                <span class="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">CDN加速</span>
              </p>
              <div class="relative rounded-md bg-gray-50 p-2 font-mono text-sm text-gray-600 transition-colors group-hover:bg-purple-50/50">
                <a
                  :href="uploadInfo.thumbnailUrl"
                  target="_blank"
                  class="break-all hover:text-purple-600 hover:underline"
                >
                  {{ uploadInfo.thumbnailUrl }}
                </a>
              </div>
            </div>

            <div class="border-t border-dashed border-gray-100 pt-3 space-y-3">
              <div class="group">
                <p class="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">CNB原图链接</p>
                <a
                  :href="uploadInfo.urlOriginal"
                  target="_blank"
                  class="block break-all text-xs text-gray-400 hover:text-gray-600"
                >
                  {{ uploadInfo.urlOriginal }}
                </a>
              </div>
              
              <div v-if="uploadInfo.thumbnailOriginalUrl" class="group">
                <p class="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">CNB缩略图链接</p>
                <a
                  :href="uploadInfo.thumbnailOriginalUrl"
                  target="_blank"
                  class="block break-all text-xs text-gray-400 hover:text-gray-600"
                >
                  {{ uploadInfo.thumbnailOriginalUrl }}
                </a>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
