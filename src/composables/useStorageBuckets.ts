import { ref } from 'vue'
import axios from '@/utils/axios'

// ===== 多存储桶管理（设置页桶卡片）=====
// 保存闭环：弹窗保存 → node 四步连接检测（成功才落盘）→ 边缘函数写 KV → 列表刷新。
// 检测失败不入库，弹窗内联展示失败步骤与原因；密钥只存服务端，前端永不持有。

export interface StorageBucketView {
  id: string
  label: string
  endpoint: string
  bucket: string
  region: string
  pathStyle: boolean
  /** 空间配额（字节）；null/undefined = 不限 ♾️ */
  quotaBytes?: number | null
  createdAt: number
  lastTestAt?: number
  lastTestOk?: boolean
}

export interface BucketSavePayload {
  id: string
  label: string
  endpoint: string
  bucket: string
  region: string
  pathStyle: boolean
  /** 空间配额（GB）；留空 = 不限 */
  quotaGb?: number
  accessKeyId?: string
  secretAccessKey?: string
}

export interface ProbeStep {
  step: 'head' | 'put' | 'get' | 'delete'
  ok: boolean
  detail: string
}

export const PROBE_STEP_LABEL: Record<ProbeStep['step'], string> = {
  head: '连接桶',
  put: '写入测试',
  get: '读取测试',
  delete: '清理测试',
}

// 模块级单例：设置页与未来其他入口共用一份列表
const buckets = ref<StorageBucketView[]>([])
const active = ref('cnb')
const loading = ref(false)
let loaded = false

export function useStorageBuckets() {
  const refresh = async (force = false) => {
    if (loaded && !force) return
    loading.value = true
    try {
      const { data } = await axios.get('/image-records', { baseURL: '', params: { 'storage-list': 1 } })
      if (data?.code === 0) {
        buckets.value = data.data?.buckets || []
        active.value = data.data?.active || 'cnb'
        loaded = true
      } else {
        throw new Error(data?.msg || '存储桶列表加载失败')
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存桶（新增/编辑）：先 node 检测（编辑未改密钥时密钥留空，服务端回填已存凭证检测），
   * 检测通过才写 KV —— 保证列表里的桶都是四步探测全过的。
   */
  const saveBucket = async (
    payload: BucketSavePayload,
  ): Promise<{ ok: boolean; message?: string; steps?: ProbeStep[] }> => {
    let probe: { ok: boolean; steps?: ProbeStep[] }
    try {
      const { data } = await axios.post('/storage/test', payload)
      probe = {
        ok: data?.code === 0 && data.data?.ok === true,
        steps: data?.data?.steps || [],
      }
      if (!probe.ok && (!probe.steps || probe.steps.length === 0)) {
        return { ok: false, message: data?.msg || '连接检测失败' }
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { msg?: string } } }
      return { ok: false, message: err?.response?.data?.msg || '连接检测失败，请检查网络' }
    }
    if (!probe.ok) {
      const failed = probe.steps?.find((s) => !s.ok)
      return {
        ok: false,
        message: failed
          ? `检测未通过（${PROBE_STEP_LABEL[failed.step]}）：${failed.detail}`
          : '连接检测失败',
        steps: probe.steps,
      }
    }
    try {
      const { data } = await axios.post('/image-records', { ...payload, lastTestOk: true }, {
        baseURL: '',
        params: { 'storage-bucket': 1 },
      })
      if (data?.code !== 0) return { ok: false, message: data?.msg || '保存失败', steps: probe.steps }
      await refresh(true)
      return { ok: true, steps: probe.steps }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { msg?: string } } }
      return { ok: false, message: err?.response?.data?.msg || '保存失败', steps: probe.steps }
    }
  }

  /** 已存桶的重新检测（密钥留空走服务端回填），结果回写 lastTest 状态 */
  const retest = async (id: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      const { data } = await axios.post('/storage/test', { id })
      const steps: ProbeStep[] = data?.data?.steps || []
      const ok = data?.code === 0 && data.data?.ok === true
      const failed = steps.find((s) => !s.ok)
      // 无论成败都回写状态（失败也如实记录，桶卡片显示异常点）
      await axios.post('/image-records', { id, ok }, { baseURL: '', params: { 'storage-test-result': 1 } }).catch(() => {})
      await refresh(true)
      if (!ok) {
        return { ok: false, message: failed ? `检测未通过（${PROBE_STEP_LABEL[failed.step]}）：${failed.detail}` : data?.msg || '检测失败' }
      }
      return { ok: true, message: `连接正常（${data?.data?.ms ?? 0}ms）` }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { msg?: string } } }
      return { ok: false, message: err?.response?.data?.msg || '检测失败，请检查网络' }
    }
  }

  /** 切换全局默认后端（全局生效：新上传进所选后端，旧图原地不动） */
  const setActive = async (id: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      const { data } = await axios.post('/image-records', { active: id }, { baseURL: '', params: { 'storage-active': 1 } })
      if (data?.code !== 0) return { ok: false, message: data?.msg || '切换失败' }
      await refresh(true)
      return { ok: true, message: data?.msg }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { msg?: string } } }
      return { ok: false, message: err?.response?.data?.msg || '切换失败' }
    }
  }

  /** 删除桶：仍有图片引用时服务端拒绝（code 1 + 原因），前端透传提示 */
  const removeBucket = async (id: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      const { data } = await axios.delete('/image-records', {
        baseURL: '',
        params: { 'storage-bucket': 1, id },
      })
      if (data?.code !== 0) return { ok: false, message: data?.msg || '删除失败' }
      await refresh(true)
      return { ok: true, message: data?.msg }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { msg?: string } } }
      return { ok: false, message: err?.response?.data?.msg || '删除失败' }
    }
  }

  return { buckets, active, loading, refresh, saveBucket, retest, setActive, removeBucket }
}
