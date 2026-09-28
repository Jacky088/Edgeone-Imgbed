import './assets/main.css'
// vue-sonner v2 需要显式引入基础样式，否则 toast 没有 fixed 定位
import 'vue-sonner/style.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { loadAuthStatus } from './router/authStatus'

const app = createApp(App)

app.use(router)

// 首帧前探测密码开关：未设 SITE_PASSWORD 时路由守卫直接放行，免去空登录页。
// 探测与首屏渲染并行，不阻塞 mount
loadAuthStatus()

app.mount('#app')
