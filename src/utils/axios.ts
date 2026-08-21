import axios from 'axios'

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
    // 添加身份验证 token
    const token = sessionStorage.getItem('site_access_token')
    if (token) {
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
      // 如果不在登录页，则跳转到登录页
      if (window.location.pathname !== '/login') {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`
      }
    }

    return Promise.reject(error)
  },
)

export default instance
