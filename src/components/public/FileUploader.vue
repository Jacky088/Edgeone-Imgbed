<template>
  <div class="w-full transition-all duration-500">
    <label
      class="group relative flex min-h-[280px] w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition-all duration-300 sm:min-h-[320px] sm:p-10"
      :class="[
        isDragging
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 scale-[1.02]'
          : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 hover:bg-gray-50/50 dark:hover:bg-gray-800/50',
      ]"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*" multiple @change="onFileChange" class="hidden" />

      <div v-if="tasks.length === 0" class="flex flex-col items-center gap-4 transition-transform duration-300 group-hover:-translate-y-1">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm transition-colors group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50">
          <UploadCloud class="h-8 w-8" />
        </div>
        <div class="space-y-1">
          <p class="text-lg font-semibold text-gray-700 dark:text-gray-200">
            {{ isDragging ? '快松手！' : '点击或拖拽上传' }}
          </p>
          <p class="text-sm text-gray-400 dark:text-gray-500">
            支持 JPG, PNG, GIF, WebP (最大 5MB)，可批量多选、Ctrl+V 粘贴或拖入整个文件夹
          </p>
        </div>
      </div>

      <div v-else-if="displayTask && displayTask.status === 'processing'" class="flex flex-col items-center gap-3 text-blue-600 dark:text-blue-400">
        <Loader2 class="h-10 w-10 animate-spin" />
        <span class="text-sm font-medium">正在压缩处理 {{ processingIndex }}/{{ tasks.length }}：{{ displayTask.rawName }}</span>
      </div>

      <div v-else-if="displayTask" class="flex w-full flex-col items-center gap-4">
        <div class="relative">
           <img
            v-if="displayTask.previewUrl"
            :src="displayTask.previewUrl"
            :alt="displayTask.rawName"
            class="h-28 w-28 rounded-2xl border-4 border-white object-cover shadow-lg ring-1 ring-gray-900/5 dark:border-gray-700 dark:ring-white/5"
          />
           <div v-else class="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
              <FileImage class="h-8 w-8" />
           </div>
           <button
            @click.stop="clearAll"
            class="absolute -right-2 -top-2 rounded-full bg-white text-red-500 shadow-md hover:text-red-600 dark:bg-gray-800 dark:text-red-400"
          >
             <XCircle class="h-5 w-5" />
          </button>
        </div>
        <div class="text-center">
          <p class="max-w-[200px] truncate text-sm font-medium text-gray-900 dark:text-gray-100">{{ displayTask.rawName }}</p>
          <div class="mt-1 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span class="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">{{ (displayTask.rawSize / 1024).toFixed(1) }} KB</span>
            <template v-if="displayTask.compressionRatio > 0">
              <span>→</span>
              <span class="rounded bg-green-50 px-1.5 py-0.5 text-green-600 dark:bg-green-900/30 dark:text-green-400">减少 {{ displayTask.compressionRatio.toFixed(0) }}%</span>
            </template>
            <span v-else class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">原图直传</span>
          </div>
          <div v-if="tasks.length > 1" class="mt-2 inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            共 {{ tasks.length }} 张，已就绪 {{ readyCount }}
          </div>
        </div>
      </div>
    </label>

    <!-- 批量任务列表：逐张展示状态 -->
    <div v-if="tasks.length > 0" class="mt-4 space-y-1.5">
      <div
        v-for="(t, idx) in tasks"
        :key="t.id"
        class="flex items-center justify-between gap-3 rounded-xl bg-gray-50/80 px-3 py-2 text-xs dark:bg-gray-800/60"
      >
        <span class="min-w-0 truncate text-gray-700 dark:text-gray-200" :title="t.rawName">
          {{ idx + 1 }}. {{ t.rawName }}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <template v-if="t.status === 'queued'">
            <span class="rounded bg-gray-200 px-1.5 py-0.5 font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">等待压缩</span>
          </template>
          <template v-else-if="t.status === 'processing'">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-blue-500" />
            <span class="font-bold text-blue-500">压缩中</span>
          </template>
          <template v-else-if="t.status === 'ready'">
            <span class="rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">就绪</span>
          </template>
          <template v-else-if="t.status === 'uploading'">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-blue-500" />
            <span class="font-bold text-blue-500">{{ t.progress }}%</span>
          </template>
          <template v-else-if="t.status === 'success'">
            <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
            <span class="font-bold text-green-500">完成</span>
          </template>
          <template v-else>
            <XCircle class="h-3.5 w-3.5 text-red-500" :title="t.errorMsg" />
            <span class="font-bold text-red-500" :title="t.errorMsg">失败</span>
            <button
              @click="retryTask(t)"
              :disabled="uploading"
              class="rounded bg-red-50 px-1.5 py-0.5 font-bold text-red-500 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
            >重试</button>
          </template>
        </span>
      </div>
    </div>

    <!-- 被拒文件：展示原因，不参与上传 -->
    <div v-if="rejectedFiles.length > 0" class="mt-2 space-y-1">
      <div
        v-for="r in rejectedFiles"
        :key="r.id"
        class="flex items-center justify-between gap-3 rounded-xl bg-gray-50/60 px-3 py-1.5 text-xs dark:bg-gray-800/40"
      >
        <span class="min-w-0 truncate text-gray-400 dark:text-gray-500" :title="r.name">{{ r.name }}</span>
        <span class="shrink-0 rounded bg-gray-200/70 px-1.5 py-0.5 font-bold text-gray-400 dark:bg-gray-700/60 dark:text-gray-500">{{ r.reason }}</span>
      </div>
    </div>

    <div v-if="uploading && uploadTask" class="mt-6 space-y-2">
      <div class="flex justify-between text-xs font-bold text-blue-600 dark:text-blue-400">
        <span class="min-w-0 truncate">正在上传 {{ uploadIndex }}/{{ tasks.length }}：{{ uploadTask.rawName }}</span>
        <span class="shrink-0">{{ uploadTask.progress }}%</span>
      </div>
      <Progress :model-value="uploadTask.progress" class="h-4 rounded-full bg-gray-200 dark:bg-gray-700" />
    </div>

    <Button
      class="mt-6 w-full h-12 rounded-xl text-base font-bold text-white shadow-lg shadow-blue-500/30 transition-all
             brand-gradient hover:brightness-110
             hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
      :disabled="!canUpload || uploading"
      @click="startUpload"
    >
      {{ uploading ? '正在飞速上传...' : tasks.length > 1 ? `开始上传（${tasks.length} 张）` : '开始上传图片' }}
    </Button>

    <p v-if="errorMsg" class="mt-4 text-center text-sm font-medium text-red-500 animate-shake">
      {{ errorMsg }}
    </p>

    <!-- 全窗口拖拽遮罩：拖到页面任意位置都能松手上传（Teleport 到 body，避免祖先 backdrop-filter 劫持 fixed 定位） -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="windowDragging" class="fixed inset-0 z-[80] bg-blue-500/10 p-4 backdrop-blur-sm sm:p-8">
          <div class="flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-4 border-dashed border-blue-500/70 bg-white/80 dark:bg-gray-900/80">
            <UploadCloud class="h-14 w-14 animate-bounce text-blue-600 dark:text-blue-400" />
            <p class="text-xl font-bold text-blue-600 dark:text-blue-300">松手即可上传</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from '@/utils/axios'
import type { AxiosProgressEvent } from 'axios'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'vue-sonner'
import { UploadCloud, XCircle, Loader2, FileImage, CheckCircle2 } from 'lucide-vue-next'
import { useUploadSettings } from '@/composables/useUploadSettings'

interface Props {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  generateThumbnail?: boolean
  thumbnailMaxWidth?: number
  thumbnailMaxHeight?: number
  thumbnailQuality?: number
}

interface UploadInfo {
  url: string
  urlOriginal?: string
  thumbnailUrl?: string
  thumbnailOriginalUrl?: string
  name: string
  size: number
  type: string
  compressionRatio: number
  width: number
  height: number
  hasThumbnail: boolean
  thumbnailWidth: number
  thumbnailHeight: number
  thumbnailSize: number
}

interface CompressResult {
  compressedFile: File
  width: number
  height: number
}

interface ThumbnailResult {
  thumbnailFile: File
  width: number
  height: number
  size: number
}

// 被拒文件：仅展示原因，不参与上传
interface RejectedFile {
  id: string
  name: string
  reason: string
}

// 批量上传任务：queued → processing(压缩) → ready → uploading → success / error
interface UploadTask {
  id: string
  rawFile: File
  rawName: string
  rawSize: number
  previewUrl: string
  file: File | null
  thumbnailFile: File | null
  status: 'queued' | 'processing' | 'ready' | 'uploading' | 'success' | 'error'
  progress: number
  compressionRatio: number
  width: number
  height: number
  thumbnailWidth: number
  thumbnailHeight: number
  thumbnailSize: number
  errorMsg: string
}

interface UploadResponse {
  code: number
  msg?: string
  data: {
    url: string
    thumbnailUrl?: string
    assets?: {
      path: string
    }
    thumbnailAssets?: {
      path: string
    }
  }
}

// 拼接 CNB 源站直链（确保恰好一个斜杠，且 path 缺失时返回空串而非 "undefined"）
function toCnbUrl(path?: string): string {
  return path ? `https://cnb.cool/${path.replace(/^\//, '')}` : ''
}

const props = withDefaults(defineProps<Props>(), {
  maxWidth: 0,
  maxHeight: 0,
  quality: 0.7,
  generateThumbnail: false,
  thumbnailMaxWidth: 200,
  thumbnailMaxHeight: 200,
  thumbnailQuality: 0.9,
})

const emit = defineEmits<{
  'update:uploadInfo': [uploadInfo: UploadInfo]
  /** 一批上传全部结束（无论成败），供父组件做自动复制等收尾 */
  'upload:finished': []
}>()

const { settings } = useUploadSettings()

const tasks = ref<UploadTask[]>([])
const rejectedFiles = ref<RejectedFile[]>([])
const processingIndex = ref(0)
const uploading = ref<boolean>(false)
const uploadIndex = ref(0)
const errorMsg = ref<string>('')
const isDragging = ref<boolean>(false)

// 全窗口拖拽：拖到页面任意位置都能松手上传
const windowDragging = ref<boolean>(false)
let dragDepth = 0

// 队首任务：拖拽区预览当前批次第一张
const displayTask = computed<UploadTask | null>(() => tasks.value[0] || null)
// 就绪待传数量
const readyCount = computed(() => tasks.value.filter((t) => t.status === 'ready').length)
// 正在上传的任务
const uploadTask = computed<UploadTask | null>(
  () => tasks.value.find((t) => t.status === 'uploading') || null,
)
// 有可传任务且不在压缩/上传中
const canUpload = computed(
  () =>
    !uploading.value &&
    tasks.value.some((t) => t.status === 'ready') &&
    !tasks.value.some((t) => t.status === 'processing'),
)

// 按命名规则生成存储文件名（保留原扩展名）
function buildStoredName(originalName: string): string {
  const ext = (originalName.match(/\.\w+$/)?.[0] || '').toLowerCase()
  const base = originalName.replace(/\.\w+$/, '')
  if (settings.value.namingRule === 'timestamp') {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    return `${ts}${ext}`
  }
  if (settings.value.namingRule === 'random') {
    return `${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}${ext}`
  }
  return originalName
}

// 粘贴的截图通常是无意义名字（image.png 等），自动改成可读的 screenshot-时间戳
function isMeaninglessName(name: string): boolean {
  return /^(image|截图|screenshot|屏幕截图)[\s\S]*\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
}

function buildScreenshotName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `screenshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`
}

async function compressImageToWebp(
  file: File,
  quality: number = 0.7,
  maxWidth: number = 0,
  maxHeight: number = 0,
): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image()
      img.src = e.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          reject(new Error('无法获取 canvas context'))
          return
        }

        let width = img.width
        let height = img.height

        if (maxWidth > 0 || maxHeight > 0) {
          if (maxWidth > 0 && maxHeight > 0) {
            const ratio = Math.min(maxWidth / width, maxHeight / height)
            if (ratio < 1) {
              width = Math.round(width * ratio)
              height = Math.round(height * ratio)
            }
          } else if (maxWidth > 0 && width > maxWidth) {
            const ratio = maxWidth / width
            width = maxWidth
            height = Math.round(height * ratio)
          } else if (maxHeight > 0 && height > maxHeight) {
            const ratio = maxHeight / height
            height = maxHeight
            width = Math.round(width * ratio)
          }
        }

        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.webp'), {
                type: 'image/webp',
              })
              resolve({
                compressedFile,
                width,
                height,
              })
            } else {
              reject(new Error('WebP 转换失败'))
            }
          },
          'image/webp',
          quality,
        )
      }
      img.onerror = () => reject(new Error('图片加载失败'))
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
  })
}

async function generateThumbnailImage(file: File): Promise<ThumbnailResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image()
      img.src = e.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          reject(new Error('无法获取 canvas context'))
          return
        }

        let width = img.width
        let height = img.height
        const maxWidth = props.thumbnailMaxWidth
        const maxHeight = props.thumbnailMaxHeight

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const thumbnailFile = new File([blob], file.name.replace(/\.\w+$/, '_thumb.webp'), {
                type: 'image/webp',
              })
              resolve({
                thumbnailFile,
                width,
                height,
                size: blob.size,
              })
            } else {
              reject(new Error('缩略图生成失败'))
            }
          },
          'image/webp',
          props.thumbnailQuality,
        )
      }
      img.onerror = () => reject(new Error('图片加载失败'))
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
  })
}

function onFileChange(e: Event): void {
  const target = e.target as HTMLInputElement
  const list = target.files ? Array.from(target.files) : []
  if (list.length > 0) {
    handleFiles(list)
  }
  // 允许重复选择同一批文件
  target.value = ''
}

function onDrop(e: DragEvent): void {
  isDragging.value = false
  const list = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
  if (list.length > 0) {
    handleFiles(list)
  }
}

// 批量入口：校验（非图片/超大/重复）→ 建队 → 逐张压缩（压缩失败仅标记该张，不中断批次）
async function handleFiles(list: File[]): Promise<void> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  // 被拒文件逐个记录原因，在队列下方持久展示（toast 只做汇总提醒）
  const rejected: RejectedFile[] = []
  const pushRejected = (name: string, reason: string) => {
    rejected.push({ id: crypto.randomUUID(), name, reason })
  }

  const seen = new Set<string>()
  const valid: File[] = []
  for (const f of list) {
    if (!allowedTypes.includes(f.type)) {
      pushRejected(f.name, '非图片格式')
      continue
    }
    // 拦截超大文件：压缩前直接拒绝并明确告知上限
    if (f.size > 5 * 1024 * 1024) {
      pushRejected(f.name, '超过 5MB')
      continue
    }
    // 批内同名/重复判重：NFC 规范化 + 小写对比
    // 覆盖：同一文件拖两次、大小写变体（Windows 文件名不区分大小写，压缩后同名）、Unicode 组合形式差异
    const key = f.name.normalize('NFC').toLowerCase()
    if (seen.has(key)) {
      pushRejected(f.name, '重复/同名')
      continue
    }
    seen.add(key)
    valid.push(f)
  }

  const typeSkipped = rejected.filter((r) => r.reason === '非图片格式').length
  const oversizeSkipped = rejected.filter((r) => r.reason === '超过 5MB').length
  const dupNames = rejected.filter((r) => r.reason === '重复/同名').map((r) => r.name)
  if (typeSkipped > 0) {
    toast.warning(`已跳过 ${typeSkipped} 个非图片文件`)
  }
  if (oversizeSkipped > 0) {
    toast.warning(`最大只允许5MB的图片上传！（已跳过 ${oversizeSkipped} 张超大图片）`)
  }
  if (dupNames.length > 0) {
    const shown = dupNames.slice(0, 3).join('、')
    toast.warning(`已跳过 ${dupNames.length} 个重复/同名文件：${shown}${dupNames.length > 3 ? ' 等' : ''}`)
  }

  rejectedFiles.value = rejected
  if (valid.length === 0) return

  revokePreviews()
  tasks.value = valid.map((f) => ({
    id: crypto.randomUUID(),
    rawFile: f,
    rawName: f.name,
    rawSize: f.size,
    previewUrl: URL.createObjectURL(f),
    file: null,
    thumbnailFile: null,
    status: 'queued',
    progress: 0,
    compressionRatio: 0,
    width: 0,
    height: 0,
    thumbnailWidth: 0,
    thumbnailHeight: 0,
    thumbnailSize: 0,
    errorMsg: '',
  }))
  errorMsg.value = ''

  // 串行压缩（CPU 密集，避免并发卡顿）
  for (let i = 0; i < tasks.value.length; i++) {
    const t = tasks.value[i]
    if (!t) continue
    processingIndex.value = i + 1
    t.status = 'processing'
    try {
      // GIF 始终跳过压缩以保留动画；开启"保持原图"时全部跳过
      const skipCompress =
        t.rawFile.type === 'image/gif' || settings.value.keepOriginal

      if (skipCompress) {
        // 原图直传：按命名规则重命名，尺寸直接读取
        const storedName = buildStoredName(t.rawName)
        t.file = new File([t.rawFile], storedName, { type: t.rawFile.type })
        const dim = await readImageSize(t.rawFile)
        t.width = dim.width
        t.height = dim.height
        t.compressionRatio = 0
      } else {
        const { compressedFile, width, height } = await compressImageToWebp(
          t.rawFile,
          props.quality,
          props.maxWidth,
          props.maxHeight,
        )
        t.compressionRatio = ((t.rawSize - compressedFile.size) / t.rawSize) * 100
        // 压缩后按命名规则重命名（保留 .webp 扩展名）
        t.file = new File([compressedFile], buildStoredName(compressedFile.name), {
          type: 'image/webp',
        })
        t.width = width
        t.height = height
      }

      if (props.generateThumbnail) {
        const thumbnail = await generateThumbnailImage(t.file)
        t.thumbnailFile = thumbnail.thumbnailFile
        t.thumbnailWidth = thumbnail.width
        t.thumbnailHeight = thumbnail.height
        t.thumbnailSize = thumbnail.size
      }
      t.status = 'ready'
    } catch (err) {
      console.error('图片处理失败:', err)
      t.status = 'error'
      t.errorMsg = err instanceof Error ? err.message : '图片处理失败'
    }
  }
}

// 读取图片原始尺寸（原图直传时 canvas 压缩管线被跳过）
function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image()
      img.src = e.target?.result as string
      img.onload = () => resolve({ width: img.width, height: img.height })
      img.onerror = () => reject(new Error('图片加载失败'))
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
  })
}

// 释放任务预览的 objectURL，避免内存泄漏
function revokePreviews(): void {
  for (const t of tasks.value) {
    if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
  }
}

function clearAll(): void {
  revokePreviews()
  tasks.value = []
  rejectedFiles.value = []
  processingIndex.value = 0
  uploadIndex.value = 0
  errorMsg.value = ''
}

// 截图后 Ctrl+V 直接粘贴上传；剪贴板没有文件时不拦截默认行为
function onPaste(e: ClipboardEvent): void {
  if (uploading.value) return
  const files = Array.from(e.clipboardData?.files || [])
  if (files.length > 0) {
    e.preventDefault()
    // 粘贴的截图名字无意义（image.png 等），自动改成可读的 screenshot-时间戳
    const renamed = files.map((f) =>
      isMeaninglessName(f.name) ? new File([f], buildScreenshotName(), { type: f.type }) : f,
    )
    handleFiles(renamed)
  }
}

function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}

function onWindowDragEnter(e: DragEvent): void {
  if (uploading.value || !dragHasFiles(e)) return
  dragDepth++
  windowDragging.value = true
}

function onWindowDragOver(e: DragEvent): void {
  if (dragDepth > 0) e.preventDefault()
}

function onWindowDragLeave(e: DragEvent): void {
  if (dragDepth === 0) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) windowDragging.value = false
}

function onWindowDrop(e: DragEvent): void {
  if (dragDepth === 0) return
  e.preventDefault()
  dragDepth = 0
  windowDragging.value = false
  isDragging.value = false
  if (uploading.value) return
  const list = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
  if (list.length > 0) {
    handleFiles(list)
  }
}

// 递归收集拖入文件夹里的所有文件（webkitGetAsEntry，Chrome/Edge/Safari 支持）
async function collectFilesFromEntries(items: DataTransferItemList): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  if (entries.length === 0) return []

  const files: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await new Promise<File | null>((resolve) =>
        fileEntry.file(resolve, () => resolve(null)),
      )
      if (file) files.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const children = await new Promise<FileSystemEntry[]>((resolve) => {
        const all: FileSystemEntry[] = []
        const readBatch = () =>
          reader.readEntries(
            (batch) => {
              if (batch.length === 0) return resolve(all)
              all.push(...batch)
              readBatch()
            },
            () => resolve(all),
          )
        readBatch()
      })
      for (const child of children) await walk(child)
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  window.addEventListener('dragenter', onWindowDragEnter)
  window.addEventListener('dragover', onWindowDragOver)
  window.addEventListener('dragleave', onWindowDragLeave)
  window.addEventListener('drop', onWindowDrop)
})
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('dragenter', onWindowDragEnter)
  window.removeEventListener('dragover', onWindowDragOver)
  window.removeEventListener('dragleave', onWindowDragLeave)
  window.removeEventListener('drop', onWindowDrop)
  revokePreviews()
})

// 单张上传 + 写记录；失败仅把该任务标记为 error，由调用方决定是否继续
async function uploadSingle(t: UploadTask): Promise<void> {
  if (!t.file) return
  t.status = 'uploading'
  t.progress = 0

  try {
    const formData = new FormData()
    formData.append('file', t.file)
    if (props.generateThumbnail && t.thumbnailFile) {
      formData.append('thumbnail', t.thumbnailFile)
    }

    const { data } = await axios.post<UploadResponse>('/upload/img', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (e.total) {
          t.progress = Math.round((e.loaded / e.total) * 100)
        }
      },
      timeout: 30000,
    })

    if (data.code !== 0) {
      throw new Error(data.msg || '上传失败')
    }

    const thumbnailUrl = data.data.thumbnailUrl || ''
    const uploadInfo: UploadInfo = {
      url: data.data.url,
      urlOriginal: toCnbUrl(data.data?.assets?.path),
      thumbnailUrl: thumbnailUrl,
      thumbnailOriginalUrl: toCnbUrl(data.data?.thumbnailAssets?.path),
      name: t.rawName,
      size: t.file.size,
      type: t.file.type,
      compressionRatio: t.compressionRatio,
      width: t.width,
      height: t.height,
      hasThumbnail: props.generateThumbnail,
      thumbnailWidth: t.thumbnailWidth,
      thumbnailHeight: t.thumbnailHeight,
      thumbnailSize: t.thumbnailSize,
    }
    emit('update:uploadInfo', uploadInfo)
    t.status = 'success'

    // 保存上传记录到 KV（同站点接口直接写入）
    try {
      await axios.post(
        '/image-records',
        {
          id: crypto.randomUUID(),
          name: t.rawName,
          url: data.data.url,
          thumbnailUrl: thumbnailUrl || undefined,
          size: t.file.size,
          type: t.file.type,
          createdAt: Date.now(),
        },
        { baseURL: '' },
      )
    } catch (recordError) {
      console.error('保存上传记录失败:', recordError)
      toast.warning(`「${t.rawName}」已上传，但链接记录保存失败`)
    }
  } catch (err) {
    console.error(err)
    const error = err as { response?: { data?: { error?: string; msg?: string } }; message?: string }
    t.status = 'error'
    t.errorMsg = error.response?.data?.error || error.response?.data?.msg || error.message || '上传失败'
    errorMsg.value = `「${t.rawName}」${t.errorMsg}`
  }
}

// 失败重试：压缩未完成的先补压缩，随后仅重传这一张
async function retryTask(t: UploadTask): Promise<void> {
  if (uploading.value || t.status !== 'error') return
  try {
    if (!t.file) {
      t.status = 'processing'
      const { compressedFile, width, height } = await compressImageToWebp(
        t.rawFile,
        props.quality,
        props.maxWidth,
        props.maxHeight,
      )
      t.compressionRatio = ((t.rawSize - compressedFile.size) / t.rawSize) * 100
      t.file = compressedFile
      t.width = width
      t.height = height

      if (props.generateThumbnail) {
        const thumbnail = await generateThumbnailImage(compressedFile)
        t.thumbnailFile = thumbnail.thumbnailFile
        t.thumbnailWidth = thumbnail.width
        t.thumbnailHeight = thumbnail.height
        t.thumbnailSize = thumbnail.size
      }
    }
    errorMsg.value = ''
    await uploadSingle(t)
  } catch (err) {
    console.error('图片处理失败:', err)
    t.status = 'error'
    t.errorMsg = err instanceof Error ? err.message : '图片处理失败'
  }
}

// 并发上传：同时传 CONCURRENCY 张，单张失败不中断批次
const CONCURRENCY = 3

async function startUpload(): Promise<void> {
  const pending = tasks.value.filter((t) => t.status === 'ready')
  if (pending.length === 0) {
    errorMsg.value = '请先选择文件'
    return
  }

  uploading.value = true
  errorMsg.value = ''

  let cursor = 0
  const total = tasks.value.length
  const worker = async () => {
    while (cursor < total) {
      const t = tasks.value[cursor++]
      if (!t || t.status !== 'ready' || !t.file) continue
      uploadIndex.value = total - pending.length + pending.filter((p) => p.status === 'uploading').length + 1
      await uploadSingle(t)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))

  uploading.value = false

  const okCount = tasks.value.filter((t) => t.status === 'success').length
  const failCount = tasks.value.filter((t) => t.status === 'error').length
  if (failCount === 0) {
    toast.success(okCount > 1 ? `${okCount} 张图片全部上传成功` : '上传成功')
  } else if (okCount > 0) {
    toast.warning(`${okCount} 张成功，${failCount} 张失败`)
  } else {
    toast.error('上传失败')
  }
  emit('upload:finished')
}
</script>
