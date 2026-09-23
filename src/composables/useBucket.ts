import { ref } from 'vue'
import axios from '@/utils/axios'

// 存储桶展示名：/api/config 返回 SLUG_IMG；失败/为空则隐藏入口
const bucket = ref('')

export function useBucket() {
  const fetchBucket = async () => {
    if (bucket.value) return
    try {
      const { data } = await axios.get('/config')
      if (data?.code === 0) bucket.value = data.data?.bucket || ''
    } catch {
      // 拿不到就不显示
    }
  }
  return { bucket, fetchBucket }
}
