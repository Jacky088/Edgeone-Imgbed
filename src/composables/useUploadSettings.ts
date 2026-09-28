import { ref, watchEffect } from 'vue'

/** 复制格式 */
export type CopyFormat = 'url' | 'markdown' | 'html' | 'bbcode'
/** 文件命名规则 */
export type NamingRule = 'original' | 'timestamp' | 'random'

export interface UploadSettings {
  /** WebP 压缩质量，限制在 0.3 - 0.95 */
  quality: number
  /** 是否同时生成缩略图链接 */
  generateThumbnail: boolean
  /** 保持原图上传（跳过压缩；GIF 恒跳过以保留动画） */
  keepOriginal: boolean
  /** 压缩尺寸上限（长边像素），0 = 不限制 */
  maxDimension: number
  /** 文件命名规则 */
  namingRule: NamingRule
  /** 默认复制格式 */
  defaultCopyFormat: CopyFormat
  /** 上传成功后自动复制 */
  autoCopy: boolean
  /** 图片列表每页条数 */
  pageSize: number
}

const STORAGE_KEY = 'upload_settings'

// 默认值：与历史硬编码参数保持一致
const DEFAULTS: UploadSettings = {
  quality: 0.7,
  generateThumbnail: true,
  keepOriginal: false,
  maxDimension: 0,
  namingRule: 'original',
  defaultCopyFormat: 'url',
  autoCopy: false,
  pageSize: 20,
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

function clampQuality(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULTS.quality
  return Math.min(0.95, Math.max(0.3, Math.round(n * 100) / 100))
}

function clampMaxDimension(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DEFAULTS.maxDimension
  return Math.min(20000, Math.round(n))
}

function clampPageSize(value: unknown): number {
  const n = Number(value)
  return PAGE_SIZE_OPTIONS.includes(n) ? n : DEFAULTS.pageSize
}

function load(): UploadSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UploadSettings>
    return {
      quality: clampQuality(parsed.quality),
      generateThumbnail: parsed.generateThumbnail !== false,
      keepOriginal: parsed.keepOriginal === true,
      maxDimension: clampMaxDimension(parsed.maxDimension),
      namingRule: parsed.namingRule === 'timestamp' || parsed.namingRule === 'random' ? parsed.namingRule : 'original',
      defaultCopyFormat: parsed.defaultCopyFormat === 'markdown' || parsed.defaultCopyFormat === 'html' || parsed.defaultCopyFormat === 'bbcode' ? parsed.defaultCopyFormat : 'url',
      autoCopy: parsed.autoCopy === true,
      pageSize: clampPageSize(parsed.pageSize),
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
