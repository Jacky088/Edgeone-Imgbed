<template>
  <div class="w-full transition-all duration-500">
    <label
      class="group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition-all duration-300"
      :class="[
        isDragging
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 scale-[1.02]'
          : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 hover:bg-gray-50/50 dark:hover:bg-gray-800/50',
      ]"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*" @change="onFileChange" class="hidden" />
      
      <div v-if="!file" class="flex flex-col items-center gap-4 transition-transform duration-300 group-hover:-translate-y-1">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm transition-colors group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50">
          <UploadCloud class="h-8 w-8" />
        </div>
        <div class="space-y-1">
          <p class="text-lg font-semibold text-gray-700 dark:text-gray-200">
            {{ isDragging ? '快松手！' : '点击或拖拽上传' }}
          </p>
          <p class="text-sm text-gray-400 dark:text-gray-500">
            支持 JPG, PNG, GIF, WebP (最大 5MB)
          </p>
        </div>
      </div>

      <div v-else-if="processing" class="flex flex-col items-center gap-3 text-blue-600 dark:text-blue-400">
        <Loader2 class="h-10 w-10 animate-spin" />
        <span class="text-sm font-medium">正在进行智能压缩与处理...</span>
      </div>

      <div v-else class="flex w-full flex-col items-center gap-4">
        <div class="relative">
           <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
              <FileImage class="h-8 w-8" />
           </div>
           <button 
            @click.stop="handleFile(null)"
            class="absolute -right-2 -top-2 rounded-full bg-white text-red-500 shadow-md hover:text-red-600 dark:bg-gray-800 dark:text-red-400"
           >
             <XCircle class="h-5 w-5" />
           </button>
        </div>
        <div class="text-center">
          <p class="max-w-[200px] truncate text-sm font-medium text-gray-900 dark:text-gray-100">{{ file.name }}</p>
          <div class="mt-1 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span class="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">{{ (file.size / 1024).toFixed(1) }} KB</span>
            <span>→</span>
            <span class="rounded bg-green-50 px-1.5 py-0.5 text-green-600 dark:bg-green-900/30 dark:text-green-400">减少 {{ compressionRatio.toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </label>

    <div v-if="uploading" class="mt-6 space-y-2">
      <div class="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300">
        <span>上传中...</span>
        <span>{{ uploadProgress }}%</span>
      </div>
      <Progress :model-value="uploadProgress" class="h-2 rounded-full bg-gray-100 dark:bg-gray-800" />
    </div>

    <Button
      class="mt-6 w-full h-12 rounded-xl text-base font-medium shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm"
      :disabled="!file || uploading"
      @click="uploadFile"
    >
      {{ uploading ? '正在飞速上传...' : '开始上传图片' }}
    </Button>

    <p v-if="errorMsg" class="mt-4 text-center text-sm font-medium text-red-500 animate-shake">
      {{ errorMsg }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import axios, { type AxiosProgressEvent } from 'axios'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'vue-sonner'
import { UploadCloud, XCircle, Loader2, FileImage } from 'lucide-vue-next'

// ... (Script 逻辑部分保持完全不变，只需复制你之前文件中的 script 内容即可) ...
// 为了确保功能正常，我将 script 部分完整列出：

interface Props {
  belongTo?: string
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
  previewUrl: string
  width: number
  height: number
  size: number
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

const props = withDefaults(defineProps<Props>(), {
  belongTo: 'mindmap',
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
}>()

const file = ref<File | null>(null)
const thumbnailFile = ref<File | null>(null)
const thumbnailPreview = ref<string>('')
const thumbnailWidth = ref<number>(0)
const thumbnailHeight = ref<number>(0)
const thumbnailSize = ref<number>(0)
const uploadProgress = ref<number>(0)
const uploading = ref<boolean>(false)
const processing = ref<boolean>(false)
const uploadedUrl = ref<string>('')
const uploadedThumbnailUrl = ref<string>('')
const errorMsg = ref<string>('')
const isDragging = ref<boolean>(false)
const compressionRatio = ref<number>(0)
const imageWidth = ref<number>(0)
const imageHeight = ref<number>(0)

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
              const previewUrl = URL.createObjectURL(blob)
              resolve({
                thumbnailFile,
                previewUrl,
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
  const f = target.files?.[0]
  if (f) {
    handleFile(f)
  }
}

function onDrop(e: DragEvent): void {
  isDragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) {
    handleFile(f)
  }
}

async function handleFile(f: File | null): Promise<void> {
  if (!f) {
    file.value = null
    thumbnailFile.value = null
    thumbnailPreview.value = ''
    return
  }

  processing.value = true

  try {
    if (f.size > 5 * 1024 * 1024) {
      errorMsg.value = '图片大小不能超过 5MB'
      return
    }
    const { compressedFile, width, height } = await compressImageToWebp(
      f,
      props.quality,
      props.maxWidth,
      props.maxHeight,
    )
    compressionRatio.value = ((f.size - compressedFile.size) / f.size) * 100
    file.value = compressedFile
    imageWidth.value = width
    imageHeight.value = height

    if (props.generateThumbnail) {
      const thumbnail = await generateThumbnailImage(compressedFile)
      thumbnailFile.value = thumbnail.thumbnailFile
      thumbnailPreview.value = thumbnail.previewUrl
      thumbnailWidth.value = thumbnail.width
      thumbnailHeight.value = thumbnail.height
      thumbnailSize.value = thumbnail.size
    }

    errorMsg.value = ''
    uploadedUrl.value = ''
    uploadedThumbnailUrl.value = ''
  } catch (err) {
    console.error('压缩失败:', err)
    errorMsg.value = '图片处理失败'
  } finally {
    processing.value = false
  }
}

async function uploadFile(): Promise<void> {
  if (!file.value) {
    errorMsg.value = '请先选择文件'
    return
  }
  try {
    uploading.value = true
    uploadProgress.value = 0
    const formData = new FormData()
    formData.append('file', file.value)
    formData.append('belongTo', props.belongTo)

    if (props.generateThumbnail && thumbnailFile.value) {
      formData.append('thumbnail', thumbnailFile.value)
    }

    const { data } = await axios.post<UploadResponse>('/api/upload/img', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (e.total) {
          uploadProgress.value = Math.round((e.loaded / e.total) * 100)
        }
      },
      timeout: 30000,
    })

    if (data.code !== 0) {
      throw new Error(data.msg || '上传失败')
    }

    uploadedUrl.value = data.data.url
    uploadedThumbnailUrl.value = data.data.thumbnailUrl || ''

    const uploadInfo: UploadInfo = {
      url: uploadedUrl.value,
      urlOriginal: 'https://cnb.cool' + data.data?.assets?.path,
      thumbnailUrl: uploadedThumbnailUrl.value,
      thumbnailOriginalUrl: 'https://cnb.cool' + data.data?.thumbnailAssets?.path,
      name: file.value.name,
      size: file.value.size,
      type: file.value.type,
      compressionRatio: compressionRatio.value,
      width: imageWidth.value,
      height: imageHeight.value,
      hasThumbnail: props.generateThumbnail,
      thumbnailWidth: thumbnailWidth.value,
      thumbnailHeight: thumbnailHeight.value,
      thumbnailSize: thumbnailSize.value,
    }
    emit('update:uploadInfo', uploadInfo)

    toast.success('上传成功')
  } catch (err) {
    console.error(err)
    const error = err as { response?: { data?: { error?: string } }; message?: string }
    errorMsg.value = error.response?.data?.error || error.message || '上传失败'
    toast.error(errorMsg.value)
  } finally {
    uploading.value = false
  }
}
</script>
