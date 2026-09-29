<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { X, HardDrive, Loader2, CheckCircle2, XCircle } from 'lucide-vue-next'
import { useStorageBuckets, type StorageBucketView, type ProbeStep } from '@/composables/useStorageBuckets'

// 桶添加/编辑弹窗：保存即检测（node 四步探测），成功才落盘并关闭；失败内联展示原因
const props = defineProps<{
  open: boolean
  bucket: StorageBucketView | null // null = 新增
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { saveBucket } = useStorageBuckets()

const isEdit = computed(() => !!props.bucket)
const form = reactive({
  id: '',
  label: '',
  endpoint: '',
  bucket: '',
  region: '',
  accessKeyId: '',
  secretAccessKey: '',
  pathStyle: true,
  /** 空间配额（GB），空字符串 = 不限 ♾️ */
  quotaGb: '',
})
const saving = ref(false)
const errorMessage = ref('')
const steps = ref<ProbeStep[]>([])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    errorMessage.value = ''
    steps.value = []
    saving.value = false
    const b = props.bucket
    form.id = b?.id || ''
    form.label = b?.label || ''
    form.endpoint = b?.endpoint || ''
    form.bucket = b?.bucket || ''
    form.region = b?.region || ''
    // 密钥永不回填（服务端掩码下发）：编辑留空 = 沿用已存密钥
    form.accessKeyId = ''
    form.secretAccessKey = ''
    form.pathStyle = b ? b.pathStyle !== false : true
    // 配额回显：字节 → GB（保留两位有效数字）；未设配额留空
    form.quotaGb = b?.quotaBytes ? String(Math.round((b.quotaBytes / 1024 ** 3) * 100) / 100) : ''
  },
)

const endpointHint = computed(() => {
  const e = form.endpoint.trim()
  if (!e) return '如 https://s3.example.com 或 R2: https://<accountId>.r2.cloudflarestorage.com'
  if (/\/.+\./.test(e.replace(/^https?:\/\//, '')) && !e.endsWith('/')) return ''
  return '端点不要带桶名与路径'
})

const close = () => {
  if (saving.value) return
  emit('close')
}

const submit = async () => {
  if (saving.value) return
  errorMessage.value = ''
  steps.value = []
  if (!form.label.trim() || !form.endpoint.trim() || !form.bucket.trim()) {
    errorMessage.value = '名称、端点、桶名为必填项'
    return
  }
  if (!isEdit.value && !/^[a-z0-9][a-z0-9-]{0,30}$/.test(form.id.trim())) {
    errorMessage.value = '标识只能用小写字母、数字和中划线（1-31 位，字母或数字开头）'
    return
  }
  if (!isEdit.value && (!form.accessKeyId.trim() || !form.secretAccessKey.trim())) {
    errorMessage.value = '新增桶需要填写 AccessKeyId 与 SecretAccessKey'
    return
  }
  if (form.quotaGb.trim() !== '') {
    const gb = Number(form.quotaGb.trim())
    if (!Number.isFinite(gb) || gb <= 0) {
      errorMessage.value = '空间配额必须是正数（GB），留空则不限制'
      return
    }
  }
  saving.value = true
  try {
    const result = await saveBucket({
      id: form.id.trim(),
      label: form.label.trim(),
      endpoint: form.endpoint.trim().replace(/\/+$/, ''),
      bucket: form.bucket.trim(),
      region: form.region.trim(),
      pathStyle: form.pathStyle,
      quotaGb: form.quotaGb.trim() === '' ? undefined : Number(form.quotaGb.trim()),
      // 编辑时留空 = 沿用已存密钥（服务端回填后再检测）
      accessKeyId: form.accessKeyId.trim() || undefined,
      secretAccessKey: form.secretAccessKey.trim() || undefined,
    })
    steps.value = result.steps || []
    if (!result.ok) {
      errorMessage.value = result.message || '保存失败'
      return
    }
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      @click.self="close"
    >
      <div class="card max-h-[90dvh] w-full max-w-lg overflow-y-auto p-6">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
              <HardDrive class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-bold text-gray-900 dark:text-white">{{ isEdit ? '编辑存储桶' : '添加 S3 存储桶' }}</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">保存前会自动连接检测（写入→读回→清理探针文件）</p>
            </div>
          </div>
          <button
            @click="close"
            class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="关闭"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-5 flex flex-col gap-4">
          <div>
            <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">
              桶标识 <span class="font-normal text-gray-400">（链接中显示，创建后不可改）</span>
            </label>
            <div class="flex items-center gap-1.5">
              <span class="shrink-0 rounded-lg bg-gray-100 px-2 py-2 text-xs font-bold text-gray-400 dark:bg-gray-800 dark:text-gray-500">s3-</span>
              <input
                v-model="form.id"
                type="text"
                :disabled="isEdit"
                placeholder="如 oss-main"
                class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500 dark:disabled:bg-gray-900"
              />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">名称</label>
            <input
              v-model="form.label"
              type="text"
              maxlength="30"
              placeholder="如 阿里云OSS主力桶"
              class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
            />
          </div>

          <div>
            <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">Endpoint</label>
            <input
              v-model="form.endpoint"
              type="text"
              placeholder="https://s3.example.com"
              class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
            />
            <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ endpointHint }}</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">桶名（Bucket）</label>
              <input
                v-model="form.bucket"
                type="text"
                placeholder="my-images"
                class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">
                Region <span class="font-normal text-gray-400">（可选）</span>
              </label>
              <input
                v-model="form.region"
                type="text"
                placeholder="us-east-1 / auto"
                class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
              />
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">AccessKeyId</label>              <input
                v-model="form.accessKeyId"
                type="text"
                autocomplete="off"
                :placeholder="isEdit ? '留空则沿用已保存的密钥' : 'AccessKeyId'"
                class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">SecretAccessKey</label>
              <input
                v-model="form.secretAccessKey"
                type="password"
                autocomplete="new-password"
                :placeholder="isEdit ? '留空则沿用已保存的密钥' : 'SecretAccessKey'"
                class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
              />
            </div>
          </div>

          <!-- 空间配额（可选）：留空 = 不限 ♾️；超出后拒绝上传 -->
          <div>
            <label class="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-300">
              空间配额（GB）<span class="font-normal text-gray-400">（可选，留空 = 不限 ♾️）</span>
            </label>
            <input
              v-model="form.quotaGb"
              type="number"
              min="0.01"
              step="any"
              placeholder="如 5 表示 5GB"
              class="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
            />
            <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">按上传记录累计计账，超出配额后新上传将被拒绝</p>
          </div>

          <label class="flex cursor-pointer items-start gap-2.5">
            <input
              v-model="form.pathStyle"
              type="checkbox"
              class="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-600"
            />
            <span class="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              Path-Style 寻址（MinIO / R2 / 国产云建议勾选；AWS 默认端点可去掉）
            </span>
          </label>

          <!-- 检测步骤反馈：失败步骤高亮，成功全绿 -->
          <div v-if="steps.length > 0" class="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
            <div v-for="s in steps" :key="s.step" class="flex items-center gap-2 py-0.5 text-xs">
              <CheckCircle2 v-if="s.ok" class="h-3.5 w-3.5 text-emerald-500" />
              <XCircle v-else class="h-3.5 w-3.5 text-red-500" />
              <span :class="s.ok ? 'text-gray-500 dark:text-gray-400' : 'font-semibold text-red-500 dark:text-red-400'">
                {{ s.detail }}
              </span>
            </div>
          </div>

          <!-- 保存失败原因（检测未过 / 校验失败） -->
          <p v-if="errorMessage" class="rounded-xl bg-red-50 p-3 text-xs font-semibold leading-relaxed text-red-500 dark:bg-red-500/10 dark:text-red-400">
            {{ errorMessage }}
          </p>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button
            @click="close"
            :disabled="saving"
            class="h-10 rounded-xl bg-gray-100 px-4 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            @click="submit"
            :disabled="saving"
            class="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
            {{ saving ? '检测中…' : '保存并检测' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
