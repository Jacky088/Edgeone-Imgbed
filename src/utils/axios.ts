import axios from 'axios'
import router from '@/router'
import { isTokenLive } from '@/utils/authToken'

// 配置 axios 基础 URL
// 开发环境和生产环境都使用 /api 作为基础路径
const instance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
instance.interceptors.request.use(
  (config) => {
    // 添加身份验证 token（过期 token 直接视为无 token，路由守卫会拦去登录页）
    const token = sessionStorage.getItem('site_access_token')
    if (token && isTokenLive(token)) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // 详细日志仅在开发环境输出，避免生产环境泄露请求数据
    if (import.meta.env.DEV) {
      console.log('[Axios] Request:', {
        url: config.url,
        method: config.method,
        baseURL: config.baseURL,
        fullURL: `${config.baseURL}${config.url}`,
      })
    }
    return config
  },
  (error) => {
    console.error('[Axios] Request Error:', error)
    return Promise.reject(error)
  },
)

// 响应拦截器
instance.interceptors.response.use(
  (response) => {
    // 详细日志（含完整响应数据）仅在开发环境输出
    if (import.meta.env.DEV) {
      console.log('[Axios] Response:', {
        url: response.config.url,
        status: response.status,
        data: response.data,
      })
    }
    return response
  },
  (error) => {
    console.error('[Axios] Response Error:', error.message)
    if (import.meta.env.DEV) {
      console.error('[Axios] Response Error Detail:', {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
        fullURL: error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown',
        status: error.response?.status,
        statusText: error.response?.statusText,
        response: error.response?.data,
      })
    }

    // 处理 401 未授权错误
    if (error.response?.status === 401) {
      sessionStorage.removeItem('site_access_token')
      localStorage.removeItem('site_access_token')
      // SPA 内跳转：保留应用状态，避免整页刷新
      if (router.currentRoute.value.name !== 'login') {
        router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
      }
    }

    return Promise.reject(error)
  },
)

export default instance
