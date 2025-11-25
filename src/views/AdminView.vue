<script setup lang="ts">
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { Trash2, ExternalLink, FileImage, AlertCircle, ArrowLeft } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'
import ThemeToggle from '@/components/ThemeToggle.vue'

interface ImageRecord {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  type: string
  createdAt: number
}

const list = ref<ImageRecord[]>([])
const loading = ref(false)

const fetchList = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/admin/list')
    if (data.code === 0) {
      list.value = data.data
    }
  } catch (e) {
    toast.error('获取列表失败')
  } finally {
    loading.value = false
  }
}

const handleDelete = async (id: string) => {
  if (!confirm('确定要删除这条记录吗？(注意：远程文件可能仍需手动清理)')) return
  try {
    const { data } = await axios.post('/api/admin/delete', { id })
    if (data.code === 0) {
      toast.success('记录已删除')
      list.value = list.value.filter(item => item.id !== id)
    } else {
      toast.error(data.msg)
    }
  } catch (e) {
    toast.error('删除失败')
  }
}

const formatDate = (ts: number) => {
  return new Date(ts).toLocaleString()
}

const formatSize = (bytes: number) => {
  return (bytes / 1024).toFixed(2) + ' KB'
}

onMounted(() => {
  fetchList()
})
</script>

<template>
  <div class="aurora-bg min-h-screen p-6 transition-colors duration-300">
    <div class="mx-auto max-w-6xl">
      
      <div class="mb-8 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Button variant="ghost" size="icon" @click="$router.push('/')" class="rounded-full hover:bg-white/50 dark:hover:bg-gray-800/50">
            <ArrowLeft class="h-5 w-5" />
          </Button>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">管理后台</h1>
        </div>
        <ThemeToggle />
      </div>

      <div class="glass-card overflow-hidden rounded-[2rem]">
        <div v-if="loading" class="p-12 text-center text-gray-500 dark:text-gray-400">
          <div class="animate-pulse">加载数据中...</div>
        </div>
        
        <div v-else-if="list.length === 0" class="flex flex-col items-center justify-center p-20 text-gray-400 dark:text-gray-600">
          <FileImage class="mb-4 h-16 w-16 opacity-20" />
          <p class="text-lg font-medium">暂无上传记录</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50/50 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400">
              <tr>
                <th class="px-6 py-4 font-medium">缩略图</th>
                <th class="px-6 py-4 font-medium">文件名 / 链接</th>
                <th class="px-6 py-4 font-medium">信息</th>
                <th class="px-6 py-4 font-medium">上传时间</th>
                <th class="px-6 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100/50 dark:divide-gray-800/50">
              <tr v-for="item in list" :key="item.id" class="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                <td class="px-6 py-4">
                  <div class="h-14 w-14 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <img 
                      :src="item.thumbnailUrl || item.url" 
                      class="h-full w-full rounded-lg object-cover" 
                      alt="preview"
                    />
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div class="font-medium text-gray-900 truncate max-w-[240px] dark:text-gray-100" :title="item.name">
                    {{ item.name }}
                  </div>
                  <a :href="item.url" target="_blank" class="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
                    查看原图 <ExternalLink class="h-3 w-3" />
                  </a>
                </td>
                <td class="px-6 py-4 text-gray-500 dark:text-gray-400">
                  <div class="font-mono text-xs">{{ formatSize(item.size) }}</div>
                  <div class="mt-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {{ item.type.split('/')[1] }}
                  </div>
                </td>
                <td class="px-6 py-4 text-gray-500 dark:text-gray-400">
                  {{ formatDate(item.createdAt) }}
                </td>
                <td class="px-6 py-4 text-right">
                  <button 
                    @click="handleDelete(item.id)"
                    class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="删除记录"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="mt-6 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-700 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-300">
        <AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
        <p>注意：由于对象存储 API 限制，目前的“删除”操作仅移除本地的历史记录，不会物理删除远程服务器上的文件。请定期登录 CNB 控制台清理。</p>
      </div>
    </div>
  </div>
</template>
