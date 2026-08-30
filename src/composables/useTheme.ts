import { ref, watchEffect } from 'vue'

// 初始化优先级：本地存储 > 系统偏好 > 日间；与 index.html 的内联脚本逻辑保持一致
function resolveInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<'light' | 'dark'>(resolveInitialTheme())

export function useTheme() {
  // 监听 theme 变化，自动应用到 html 标签
  watchEffect(() => {
    const root = window.document.documentElement
    // 移除旧的 class
    root.classList.remove('light', 'dark')
    // 添加新的 class
    root.classList.add(theme.value)
  })

  const toggleTheme = () => {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    // 仅在用户显式切换时才持久化；从未切换过则持续跟随系统偏好
    localStorage.setItem('theme', theme.value)
  }

  return { theme, toggleTheme }
}
