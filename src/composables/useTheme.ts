import { ref, watchEffect } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

// 初始化优先级：本地存储 > 系统偏好 > 日间；与 index.html 的内联脚本逻辑保持一致
function resolveInitialMode(): ThemeMode {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const mode = ref<ThemeMode>(resolveInitialMode())

// 跟随系统时监听系统偏好变化，实时切换
const media = window.matchMedia('(prefers-color-scheme: dark)')
media.addEventListener('change', () => {
  if (mode.value === 'system') applyTheme()
})

function applyTheme() {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  const resolved = mode.value === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode.value
  root.classList.add(resolved)
}

applyTheme()

export function useTheme() {
  // 监听 mode 变化，自动应用到 html 标签
  watchEffect(() => {
    applyTheme()
    // 仅在用户显式选择时持久化；system 表示跟随系统偏好
    localStorage.setItem('theme', mode.value)
  })

  // 兼容旧调用：在日/夜之间切换（会脱离"跟随系统"）
  const toggleTheme = () => {
    const current = mode.value === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode.value
    mode.value = current === 'light' ? 'dark' : 'light'
  }

  return { theme: mode, toggleTheme }
}
