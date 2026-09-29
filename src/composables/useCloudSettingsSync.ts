import { watch } from 'vue'
import axios from '@/utils/axios'
import { useUploadSettings } from './useUploadSettings'
import { useTheme } from './useTheme'

// ===== 站点设置云端同步（登录即一致，全设备共享）=====
// 分层：localStorage 为即时层（离线兜底、首屏无闪白），云端 KV 为准据源。
// 启动：拉云端文档 → 有值以云端覆盖本地（服务端已做白名单钳制）；云端为空（首次）→ 本机当前值播种上传。
// 运行：本地改动（含恢复默认）防抖 600ms 回写；回写期间与刚推送内容不重复发。
// 本机上传目标（useBucket 的 override）不在此列——那是设备级覆盖，站点默认本就在云端。

const { settings } = useUploadSettings()
const { theme } = useTheme()

let started = false
let applying = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushedJson = ''

/** 是否正在回放云端设置（区分"用户点击改动"与"同步应用"，供 UI 提示层抑制误报） */
export function isSyncApplying(): boolean {
  return applying
}

const payloadJson = () => JSON.stringify({ uploadSettings: settings.value, theme: theme.value })

const pushNow = async () => {
  const json = payloadJson()
  if (json === lastPushedJson) return
  lastPushedJson = json
  try {
    await axios.post('/image-records', JSON.parse(json), {
      baseURL: '',
      params: { 'site-settings': 1 },
      timeout: 8000,
    })
  } catch {
    // 回写失败：本地仍是即时层，用户下次改动会整体重推
    lastPushedJson = ''
  }
}

const schedulePush = () => {
  if (applying) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(pushNow, 600)
}

// watch 必须注册在模块顶层（组件 effect scope 之外）：AppShell 随视图切换反复卸载，
// 若在组件生命周期内注册，导航时会随组件 scope.stop() 一并销毁，云端回写从此静默失效
watch([settings, theme], schedulePush, { deep: true })

export function startCloudSettingsSync() {
  if (started) return
  started = true

  void (async () => {
    try {
      const { data } = await axios.get('/image-records', {
        baseURL: '',
        params: { 'site-settings': 1 },
        timeout: 8000,
      })
      if (data?.code !== 0) return
      const doc = data.data
      if (doc && (doc.uploadSettings || doc.theme)) {
        applying = true
        try {
          if (doc.uploadSettings) {
            settings.value = { ...settings.value, ...doc.uploadSettings }
          }
          if (doc.theme === 'light' || doc.theme === 'dark' || doc.theme === 'system') {
            theme.value = doc.theme
          }
        } finally {
          applying = false
        }
        // 应用后立即推送会把同样内容原样回写，记录基线避免冗余请求
        lastPushedJson = payloadJson()
      } else {
        // 站点从未同步过：本机当前值作为初始设置上传
        void pushNow()
      }
    } catch {
      // 拉取失败（离线/后端异常）：维持本机设置，不阻断页面
    }
  })()
}
