import { createRouter, createWebHistory } from 'vue-router'
import { isTokenLive } from '@/utils/authToken'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../views/AdminView.vue'),
    },
    // [新增] 登录页路由
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
    // [新增] 侧边栏占位页路由
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

// [新增] 全局前置守卫
router.beforeEach((to, from, next) => {
  // 同步双存储：localStorage（"记住我"）的 token 也镜像一份到 sessionStorage，
  // axios 拦截器只读 sessionStorage，避免两边不一致
  const remembered = localStorage.getItem('site_access_token')
  if (remembered && !sessionStorage.getItem('site_access_token')) {
    sessionStorage.setItem('site_access_token', remembered)
  }

  // 1. 检查是否有 token，并预判是否过期（过期 token 视为未登录，直接拦去登录页）
  const token = sessionStorage.getItem('site_access_token') || remembered
  const isAuthenticated = !!token && isTokenLive(token)

  // 2. 如果要去的是登录页，且已经登录，直接去首页
  if (to.name === 'login' && isAuthenticated) {
    next({ name: 'home' })
    return
  }

  // 3. 如果没有登录，且去的不是登录页，拦截跳转到登录页
  if (to.name !== 'login' && !isAuthenticated) {
    // 将用户原本想去的地址作为参数传过去，登录成功后跳回来
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  // 4. 放行
  next()
})

export default router
