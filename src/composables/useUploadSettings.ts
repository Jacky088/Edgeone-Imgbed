import { ref, watchEffect } from 'vue'

export interface UploadSettings {
  /** WebP 压缩质量，限制在 0.3 - 0.95 */
  quality: number
  /** 是否同时生成缩略图链接 */
  generateThumbnail: boolean
}

const STORAGE_KEY = 'upload_settings'

// 默认值与 HomeView 原硬编码参数保持一致
const DEFAULTS: UploadSettings = {
  quality: 0.7,
  generateThumbnail: true,
}

function clampQuality(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULTS.quality
  return Math.min(0.95, Math.max(0.3, Math.round(n * 100) / 100))
}

function load(): UploadSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UploadSettings>
    return {
      quality: clampQuality(parsed.quality),
      generateThumbnail: parsed.generateThumbnail !== false,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const settings = ref<UploadSettings>(load())

watchEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
})

export function useUploadSettings() {
  const resetSettings = () => {
    settings.value = { ...DEFAULTS }
  }
  return { settings, resetSettings }
}
