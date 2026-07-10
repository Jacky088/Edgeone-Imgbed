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
    console.log('[Axios] Request:', {
      url: config.url,
      method: config.method,
      baseURL: config.baseURL,
      fullURL: `${config.baseURL}${config.url}`,
    })
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
    console.log('[Axios] Response:', {
      url: response.config.url,
      status: response.status,
      data: response.data,
    })
    return response
  },
  (error) => {
    console.error('[Axios] Response Error:', {
      url: error.config?.url,
      method: error.config?.method,
      baseURL: error.config?.baseURL,
      fullURL: error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown',
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      response: error.response?.data,
    })
    return Promise.reject(error)
  },
)

export default instance
