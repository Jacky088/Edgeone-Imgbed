import './assets/main.css'
// vue-sonner v2 需要显式引入基础样式，否则 toast 没有 fixed 定位
import 'vue-sonner/style.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)

app.mount('#app')
