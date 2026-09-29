import { computed, ref } from 'vue'
import axios from '@/utils/axios'

// ===== 上传目标选择（顶栏桶下拉）=====
// storages 来自 /config（CNB + 已配置 S3 桶）；globalActive 为站点默认（设置页可改）；
// override 为本机覆盖（localStorage，仅影响本浏览器发起的上传，随请求 storage 字段下发）。
// 自愈闭环：覆盖目标在 /config 里已不存在（被删除）时自动清除，回落站点默认。

export interface StorageOption {
  id: string
  label: string
  type: 'cnb' | 's3'
  /** 空间配额（字节）；null = 不限 ♾️ */
  quotaBytes?: number | null
}

const OVERRIDE_KEY = 'upload_storage_override'

// 模块级单例：全站顶栏共用
const cnbBucket = ref('') // CNB 桶名（SLUG_IMG）
const storages = ref<StorageOption[]>([])
const globalActive = ref('cnb')
const override = ref('')
let loaded = false

function readOverride(): string {
  try {
    return localStorage.getItem(OVERRIDE_KEY) || ''
  } catch {
    return ''
  }
}

function writeOverride(id: string) {
  try {
    if (id) localStorage.setItem(OVERRIDE_KEY, id)
    else localStorage.removeItem(OVERRIDE_KEY)
  } catch {
    // 隐私模式等场景静默降级（仅本次会话生效）
  }
}

export function useBucket() {
  // 生效目标：本机覆盖（仍存在时）> 站点默认
  const effectiveId = computed(() => {
    if (override.value && storages.value.some((s) => s.id === override.value)) return override.value
    return globalActive.value
  })

  // 徽标展示名：CNB → 桶名 slug；S3 → 用户命名
  const bucket = computed(() => {
    const eff = effectiveId.value
    if (eff === 'cnb') return cnbBucket.value
    return storages.value.find((s) => s.id === eff)?.label || ''
  })

  const fetchBucket = async (force = false) => {
    if (loaded && !force) return
    try {
      const { data } = await axios.get('/config')
      if (data?.code === 0) {
        cnbBucket.value = data.data?.cnbBucket || data.data?.bucket || ''
        storages.value = Array.isArray(data.data?.storages) && data.data.storages.length > 0
          ? data.data.storages
          : [{ id: 'cnb', label: 'CNB 对象存储', type: 'cnb' as const, quotaBytes: null }]
        globalActive.value = data.data?.active || 'cnb'
        override.value = readOverride()
        // 自愈：覆盖目标已被删除 → 清除覆盖，回落站点默认
        if (override.value && !storages.value.some((s) => s.id === override.value)) {
          override.value = ''
          writeOverride('')
        }
        loaded = true
      }
    } catch {
      // 拿不到就不显示
    }
  }

  /** 顶栏下拉选择：写入本机覆盖（选站点默认 = 清除覆盖） */
  const selectStorage = (id: string) => {
    override.value = id === globalActive.value ? '' : id
    writeOverride(override.value)
  }

  return { bucket, storages, globalActive, effectiveId, fetchBucket, selectStorage }
}
