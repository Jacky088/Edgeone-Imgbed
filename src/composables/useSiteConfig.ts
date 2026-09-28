import { ref } from 'vue'

// 全站配置（/api/config 的免探测缓存）：密码开关、桶名、服务端上传上限。
// 未登录时 /config 需要 auth，因此 passwordEnabled 走公开的 /api/auth/status
export interface SiteConfig {
  bucket: string
  passwordEnabled: boolean
  maxUploadMb: number
}

const DEFAULT_MAX_UPLOAD_MB = 25

const bucket = ref('')
const passwordEnabled = ref<boolean | null>(null) // null = 未知（探测中/失败）
const maxUploadMb = ref(DEFAULT_MAX_UPLOAD_MB)
let fetched = false

export function useSiteConfig() {
  const load = async (axios: import('axios').AxiosInstance) => {
    if (fetched) return
    fetched = true
    try {
      const { data } = await axios.get('/auth/status', { baseURL: '' })
      if (data?.code === 0) {
        passwordEnabled.value = data.data?.passwordEnabled !== false
      }
    } catch {
      passwordEnabled.value = true // 探测失败按有密码处理，走常规登录流程
    }
    fetched = false
  }

  const loadFull = async (axios: import('axios').AxiosInstance) => {
    try {
      const { data } = await axios.get('/config')
      if (data?.code === 0) {
        bucket.value = data.data?.bucket || ''
        if (typeof data.data?.passwordEnabled === 'boolean') {
          passwordEnabled.value = data.data.passwordEnabled
        }
        if (Number(data.data?.maxUploadMb) > 0) {
          maxUploadMb.value = Number(data.data.maxUploadMb)
        }
      }
    } catch {
      // 拿不到就不显示桶名，上限保持默认
    }
  }

  return { bucket, passwordEnabled, maxUploadMb, load, loadFull }
}
