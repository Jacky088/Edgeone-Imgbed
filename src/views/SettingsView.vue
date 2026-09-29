<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Settings,
  RotateCcw,
  Images,
  Copy,
  Ruler,
  FileText,
  Rows3,
  Type,
  HardDrive,
  Plus,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppShell from '@/components/layout/AppShell.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import StorageBucketModal from '@/components/StorageBucketModal.vue'
import { useUploadSettings, PAGE_SIZE_OPTIONS, type CopyFormat, type NamingRule } from '@/composables/useUploadSettings'
import { useStorageBuckets, type StorageBucketView } from '@/composables/useStorageBuckets'
import { useBucket } from '@/composables/useBucket'
import { useTheme } from '@/composables/useTheme'
import { isSyncApplying } from '@/composables/useCloudSettingsSync'
import { toast } from 'vue-sonner'

// 上传压缩为浏览器端 WebP 管线，仅调整参数，不改变上传接口行为
const { settings, resetSettings } = useUploadSettings()
const { theme } = useTheme()

// 设置变更即时生效（点击即改 + 云端同步防抖回写）；每次改动在顶部 toast「设置已保存」自动消失。
// flush:'sync' 让回调恰在用户点击处理器内触发；云端同步回放期间 isSyncApplying() 为 true，
// 回放触发的变更不弹提示；「恢复默认」有自己的提示，suppress 掉通用 toast 避免双弹。
let saveToastTimer: ReturnType<typeof setTimeout> | null = null
let suppressSaveToast = false
watch(
  [settings, theme],
  () => {
    if (isSyncApplying()) return
    if (suppressSaveToast) {
      suppressSaveToast = false
      return
    }
    if (saveToastTimer) clearTimeout(saveToastTimer)
    saveToastTimer = setTimeout(() => toast.success('设置已保存'), 500)
  },
  { deep: true, flush: 'sync' },
)

// ===== 多存储桶管理：列表/检测/切换默认/删除（闭环见 useStorageBuckets 注释）=====
const { buckets, active, loading: bucketsLoading, refresh: refreshBuckets, retest, setActive, removeBucket } = useStorageBuckets()
// 顶栏桶下拉共用 /config 上下文：默认切换/增删桶后强制刷新，徽标与菜单立即反映最新状态
const { fetchBucket: refreshBucketContext } = useBucket()
const bucketModalOpen = ref(false)
const editingBucket = ref<StorageBucketView | null>(null)
const deletingBucket = ref<StorageBucketView | null>(null)
const deletingBucketNow = ref(false)
const testingId = ref('')
const switchingId = ref('')

onMounted(() => {
  refreshBuckets().catch(() => {})
})

const endpointHost = (endpoint: string) => endpoint.replace(/^https?:\/\//, '')

const openAddBucket = () => {
  editingBucket.value = null
  bucketModalOpen.value = true
}
const openEditBucket = (b: StorageBucketView) => {
  editingBucket.value = b
  bucketModalOpen.value = true
}
const handleRetest = async (b: StorageBucketView) => {
  if (testingId.value) return
  testingId.value = b.id
  try {
    const r = await retest(b.id)
    if (r.ok) toast.success(r.message || '连接正常')
    else toast.error(r.message || '检测失败')
  } finally {
    testingId.value = ''
  }
}
const handleSetActive = async (id: string) => {
  if (switchingId.value) return
  switchingId.value = id
  try {
    const r = await setActive(id)
    if (r.ok) {
      toast.success(r.message || '默认存储已切换')
      refreshBucketContext(true)
    } else toast.error(r.message || '切换失败')
  } finally {
    switchingId.value = ''
  }
}
const handleDeleteBucket = async () => {
  if (!deletingBucket.value) return
  deletingBucketNow.value = true
  try {
    const r = await removeBucket(deletingBucket.value.id)
    if (r.ok) {
      toast.success(r.message || '已删除存储桶')
      refreshBucketContext(true)
    } else toast.error(r.message || '删除失败')
    deletingBucket.value = null
  } finally {
    deletingBucketNow.value = false
  }
}

const qualityOptions = [
  { value: 0.5, label: '0.5', hint: '最小' },
  { value: 0.6, label: '0.6', hint: '较小' },
  { value: 0.7, label: '0.7', hint: '推荐' },
  { value: 0.8, label: '0.8', hint: '较清晰' },
  { value: 0.9, label: '0.9', hint: '最清晰' },
]

// 「原始」= 不压缩、不转换，保持原始格式与大小；选择质量档位即代表开启压缩
const pickQuality = (q: number) => {
  settings.value.keepOriginal = false
  settings.value.quality = q
}

const currentModeText = computed(() =>
  settings.value.keepOriginal
    ? '原始（不压缩不转换）'
    : `${settings.value.quality}（${qualityOptions.find((q) => q.value === settings.value.quality)?.hint || '自定义'}）`,
)

const maxDimensionOptions = [
  { value: 0, label: '不限制' },
  { value: 3840, label: '4K' },
  { value: 2560, label: '2K' },
  { value: 1920, label: '1920px' },
  { value: 1280, label: '1280px' },
]

const namingOptions: Array<{ value: NamingRule; label: string; hint: string }> = [
  { value: 'original', label: '保留原名', hint: '同名可能覆盖' },
  { value: 'timestamp', label: '时间戳', hint: '默认 · 防同名覆盖' },
  { value: 'random', label: '随机 ID', hint: '短随机字符' },
]

const copyFormatOptions: Array<{ value: CopyFormat; label: string }> = [
  { value: 'url', label: '直链' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'bbcode', label: 'BBCode' },
]

const handleReset = () => {
  suppressSaveToast = true
  resetSettings()
  toast.success('已恢复默认设置')
}
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white">
          <Settings class="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          我的设置
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">上传压缩与外观偏好（云端同步 · 登录即全设备一致）</p>
      </div>

      <!-- 设置卡片网格：移动端单列，桌面端双列；宽卡（压缩）占满整行 -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- 压缩模式：原始 / 质量档位 -->
        <div class="card p-6 lg:col-span-2">
          <div class="flex flex-col gap-5">
            <div>
              <p class="text-sm font-bold text-gray-900 dark:text-white">图片压缩</p>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                压缩时自动转为 WebP，质量越低体积越小；「原始」不压缩、不转换，保持原始格式和大小。
                当前：{{ currentModeText }}（GIF 动图始终保留以维持动画）
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                @click="settings.keepOriginal = true"
                class="flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 text-sm font-bold transition-all"
                :class="
                  settings.keepOriginal
                    ? 'brand-gradient text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                <span>原始</span>
                <span
                  class="text-[10px] font-medium"
                  :class="settings.keepOriginal ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'"
                >不压缩</span>
              </button>
              <button
                v-for="q in qualityOptions"
                :key="q.value"
                @click="pickQuality(q.value)"
                class="flex min-w-[64px] flex-col items-center rounded-xl px-3 py-2 text-sm font-bold transition-all"
                :class="
                  !settings.keepOriginal && settings.quality === q.value
                    ? 'brand-gradient text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                <span>{{ q.label }}</span>
                <span
                  v-if="q.hint"
                  class="text-[10px] font-medium"
                  :class="!settings.keepOriginal && settings.quality === q.value ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'"
                >{{ q.hint }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 压缩尺寸上限（原始模式下不生效） -->
        <div class="card p-6" :class="settings.keepOriginal ? 'opacity-50' : ''">
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Ruler class="h-5 w-5" />
            </div>
            <div class="min-w-[160px] flex-1">
              <p class="text-sm font-bold text-gray-900 dark:text-white">压缩尺寸上限</p>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {{ settings.keepOriginal ? '原始模式下不压缩尺寸，此设置不生效' : '长边超过上限时等比缩小，进一步减小体积' }}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="opt in maxDimensionOptions"
                  :key="opt.value"
                  @click="settings.maxDimension = opt.value"
                  class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
                  :class="
                    settings.maxDimension === opt.value
                      ? 'brand-gradient text-white shadow-md shadow-indigo-500/25'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  "
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 开关组：缩略图 / 自动复制 -->
        <div class="card p-6">
          <div class="flex flex-col divide-y divide-gray-100/70 dark:divide-gray-800/50">
            <!-- 缩略图 -->
            <div class="flex items-center justify-between gap-4 pb-5">
              <div class="flex items-start gap-3">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
                  <Images class="h-5 w-5" />
                </div>
                <div>
                  <p class="text-sm font-bold text-gray-900 dark:text-white">生成缩略图链接</p>
                  <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    关闭后仅保留原图链接，上传更快；已保存的结果卡不受影响
                  </p>
                </div>
              </div>
              <button
                role="switch"
                :aria-checked="settings.generateThumbnail"
                :title="settings.generateThumbnail ? '点击关闭' : '点击开启'"
                @click="settings.generateThumbnail = !settings.generateThumbnail"
                class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                :class="settings.generateThumbnail ? 'brand-gradient' : 'bg-gray-300 dark:bg-gray-700'"
              >
                <span
                  class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  :class="settings.generateThumbnail ? 'translate-x-5' : ''"
                ></span>
              </button>
            </div>

            <!-- 上传后自动复制 -->
            <div class="flex items-center justify-between gap-4 pt-5">
              <div class="flex items-start gap-3">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
                  <Copy class="h-5 w-5" />
                </div>
                <div>
                  <p class="text-sm font-bold text-gray-900 dark:text-white">上传后自动复制</p>
                  <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    全部上传完成后，自动按下方默认格式复制链接
                  </p>
                </div>
              </div>
              <button
                role="switch"
                :aria-checked="settings.autoCopy"
                :title="settings.autoCopy ? '点击关闭' : '点击开启'"
                @click="settings.autoCopy = !settings.autoCopy"
                class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                :class="settings.autoCopy ? 'brand-gradient' : 'bg-gray-300 dark:bg-gray-700'"
              >
                <span
                  class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  :class="settings.autoCopy ? 'translate-x-5' : ''"
                ></span>
              </button>
            </div>
          </div>
        </div>

        <!-- 文件命名规则 -->
        <div class="card p-6">
          <div class="flex items-center gap-2">
            <Type class="h-4 w-4 text-indigo-500" />
            <p class="text-sm font-bold text-gray-900 dark:text-white">文件命名规则</p>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">决定存储在图床里的文件名</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="opt in namingOptions"
              :key="opt.value"
              @click="settings.namingRule = opt.value"
              class="flex flex-col items-center rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              :class="
                settings.namingRule === opt.value
                  ? 'brand-gradient text-white shadow-md shadow-indigo-500/25'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              "
            >
              <span>{{ opt.label }}</span>
              <span
                class="text-[10px] font-medium"
                :class="settings.namingRule === opt.value ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'"
              >{{ opt.hint }}</span>
            </button>
          </div>
        </div>

        <!-- 默认复制格式 -->
        <div class="card p-6">
          <div class="flex items-center gap-2">
            <FileText class="h-4 w-4 text-indigo-500" />
            <p class="text-sm font-bold text-gray-900 dark:text-white">默认复制格式</p>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">自动复制与结果卡首推的格式</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="opt in copyFormatOptions"
              :key="opt.value"
              @click="settings.defaultCopyFormat = opt.value"
              class="rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              :class="
                settings.defaultCopyFormat === opt.value
                  ? 'brand-gradient text-white shadow-md shadow-indigo-500/25'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              "
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 存储桶管理：多桶配置 + 全局默认切换（保存即检测，检测不过不入库） -->
        <div class="card p-6 lg:col-span-2">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div class="flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
                <HardDrive class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">存储桶管理</p>
                <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  对象存储后端：默认 CNB；切换后新上传进入所选桶，已有图片的链接不受影响
                </p>
              </div>
            </div>
            <button
              @click="openAddBucket"
              class="flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl brand-gradient px-4 text-xs font-bold text-white shadow-md shadow-indigo-500/25 transition-all hover:opacity-90"
            >
              <Plus class="h-4 w-4" />
              添加 S3 桶
            </button>
          </div>

          <div class="mt-4 flex flex-col divide-y divide-gray-100/70 dark:divide-gray-800/50">
            <!-- CNB 内置默认 -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl brand-gradient text-white">
                <Cloud class="h-4 w-4" />
              </div>
              <div class="min-w-[160px] flex-1">
                <p class="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  CNB 对象存储
                  <span
                    v-if="active === 'cnb'"
                    class="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
                  >默认</span>
                </p>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">内置存储（由 SLUG_IMG / TOKEN_IMG 环境变量配置）</p>
              </div>
              <button
                v-if="active !== 'cnb'"
                @click="handleSetActive('cnb')"
                :disabled="switchingId === 'cnb'"
                class="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
              >
                <Loader2 v-if="switchingId === 'cnb'" class="h-3.5 w-3.5 animate-spin" />
                设为默认
              </button>
            </div>

            <!-- S3 桶列表 -->
            <div v-for="b in buckets" :key="b.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <HardDrive class="h-4 w-4" />
              </div>
              <div class="min-w-[160px] flex-1">
                <p class="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span class="truncate">{{ b.label }}</span>
                  <span
                    v-if="active === b.id"
                    class="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
                  >默认</span>
                  <span class="shrink-0 font-mono text-[10px] font-medium text-gray-400 dark:text-gray-500">s3-{{ b.id }}</span>
                </p>
                <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ endpointHost(b.endpoint) }} / {{ b.bucket }} · {{ b.pathStyle !== false ? 'Path-Style' : 'Virtual-Host' }}
                </p>
              </div>
              <!-- 检测状态点 -->
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="b.lastTestOk === true ? 'bg-emerald-500' : b.lastTestOk === false ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'"
                :title="b.lastTestAt ? `最近检测：${new Date(b.lastTestAt).toLocaleString()}（${b.lastTestOk ? '正常' : '异常'}）` : '未检测'"
              ></span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  v-if="active !== b.id"
                  @click="handleSetActive(b.id)"
                  :disabled="switchingId === b.id"
                  class="flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-bold text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                >
                  <Loader2 v-if="switchingId === b.id" class="h-3.5 w-3.5 animate-spin" />
                  设为默认
                </button>
                <button
                  @click="handleRetest(b)"
                  :disabled="testingId === b.id"
                  class="flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-bold text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                  title="重新连接检测"
                >
                  <Loader2 v-if="testingId === b.id" class="h-3.5 w-3.5 animate-spin" />
                  检测
                </button>
                <button
                  @click="openEditBucket(b)"
                  class="flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-bold text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                >
                  <Pencil class="h-3.5 w-3.5" />
                  编辑
                </button>
                <button
                  @click="deletingBucket = b"
                  class="flex h-8 items-center gap-1 rounded-lg border border-red-200 px-2.5 text-xs font-bold text-red-500 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
            </div>

            <p v-if="bucketsLoading && buckets.length === 0" class="py-4 text-xs text-gray-400 dark:text-gray-500">加载中…</p>
            <p v-else-if="buckets.length === 0" class="py-4 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
              还没有添加 S3 存储桶；不添加时所有上传走 CNB。支持 AWS S3 / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS / MinIO 等 S3 兼容存储。
            </p>
          </div>

          <StorageBucketModal
            :open="bucketModalOpen"
            :bucket="editingBucket"
            @close="bucketModalOpen = false"
            @saved="() => { toast.success('存储桶已保存，连接检测通过'); refreshBucketContext(true) }"
          />

          <ConfirmDialog
            :open="!!deletingBucket"
            :title="`删除存储桶「${deletingBucket?.label}」？`"
            description="仅断开连接，不会删除桶内已有对象；若仍有图片引用该桶，将无法删除。"
            confirm-text="删除"
            :loading="deletingBucketNow"
            @confirm="handleDeleteBucket"
            @cancel="deletingBucket = null"
          />
        </div>

        <!-- 列表每页条数 -->
        <div class="card p-6">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
                <Rows3 class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">列表每页条数</p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">图片列表分页大小：当前 {{ settings.pageSize }} 条</p>
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                v-for="n in PAGE_SIZE_OPTIONS"
                :key="n"
                @click="settings.pageSize = n"
                class="h-8 w-12 rounded-lg text-xs font-bold transition-all"
                :class="
                  settings.pageSize === n
                    ? 'brand-gradient text-white shadow-md shadow-indigo-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                "
              >
                {{ n }}
              </button>
            </div>
          </div>
        </div>

        <!-- 外观主题 -->
        <div class="card p-6">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="min-w-0">
              <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">外观主题</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">日间 / 夜间 / 跟随系统</p>
            </div>
            <div class="shrink-0"><ThemeToggle /></div>
          </div>
        </div>
      </div>

      <!-- 恢复默认 -->
      <div class="flex justify-end">
        <button
          @click="handleReset"
          class="flex h-10 items-center gap-2 rounded-xl bg-gray-100 px-4 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RotateCcw class="h-4 w-4" />
          恢复默认设置
        </button>
      </div>
    </div>
  </AppShell>
</template>
