import axios from '@/utils/axios'

// 密码开关探测结果：null = 未知（请求中/失败），true = 有密码，false = 开放访问
let passwordEnabled: boolean | null = null
let pending: Promise<void> | null = null

// 探测是否已设置 SITE_PASSWORD（公开接口，无需登录态）
export function loadAuthStatus(): Promise<void> {
  if (passwordEnabled !== null) return Promise.resolve()
  if (!pending) {
    pending = axios
      .get('/auth/status', { baseURL: '', timeout: 5000 })
      .then(({ data }) => {
        if (data?.code === 0) passwordEnabled = data.data?.passwordEnabled !== false
      })
      .catch(() => {
        // 探测失败按有密码处理，走常规登录流程
        passwordEnabled = true
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function isPasswordEnabled(): boolean | null {
  return passwordEnabled
}
