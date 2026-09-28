<script setup lang="ts">
import { computed, ref } from 'vue'
import axios from '@/utils/axios'
import { Settings, RotateCcw, Images, Copy, Ruler, FileText, Rows3, Type, SearchCode, Trash2 } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { useUploadSettings, PAGE_SIZE_OPTIONS, type CopyFormat, type NamingRule } from '@/composables/useUploadSettings'
import { useStorageUsage } from '@/composables/useStorageUsage'
import { formatCompactSize } from '@/utils/format'
import { toast } from 'vue-sonner'

// 上传压缩为浏览器端 WebP 管线，仅调整参数，不改变上传接口行为
const { settings, resetSettings } = useUploadSettings()
// 孤儿清理成功后强制刷新侧栏存储卡（refresh=1 绕过服务端 10 分钟缓存）
const { fetchUsage } = useStorageUsage()

// ===== CNB 孤儿文件扫描（平台资产清单 vs 上传记录）=====
interface OrphanAsset {
  path: string
  size: number
  createdAt: string
}
const scanState = ref<'idle' | 'scanning' | 'done' | 'error'>('idle')
const scanMsg = ref('')
const scanMeta = ref<{ scanned: number; otherTypes: number; truncated: boolean } | null>(null)
const orphans = ref<OrphanAsset[]>([])
const orphanPurging = ref(false)

const orphanTotalSize = computed(() => orphans.value.reduce((sum, o) => sum + (o.size || 0), 0))

// 展示与图片列表一致的卡片网格；缩略图(_thumb.webp)与主图同生共死，主图已在列表时隐藏避免重复卡片
const displayOrphans = computed(() =>
  orphans.value.filter((o) => {
    if (!/_thumb\.webp$/.test(o.path)) return true
    const main = o.path.replace(/_thumb\.webp$/, '')
    return !orphans.value.some((x) => x.path === main)
  }),
)
const hiddenThumbCount = computed(() => orphans.value.length - displayOrphans.value.length)

// 代理同源输出（/api/img 白名单与上传扩展名一致），点击新窗口查看原图
const orphanUrl = (o: OrphanAsset) => `/api/img/${o.path}`
const orphanName = (o: OrphanAsset) => o.path.split('/').pop() || o.path
const orphanExt = (o: OrphanAsset) => (orphanName(o).split('.').pop() || 'img').toLowerCase()
const orphanDate = (o: OrphanAsset) => {
  const t = Date.parse(o.createdAt || '')
  return Number.isFinite(t) ? new Date(t).toLocaleDateString() : '—'
}

// 扫描只读不删：孤儿 = CNB 平台清单里存在、但没有任何记录（含回收站）引用的图片
const scanOrphans = async () => {
  if (scanState.value === 'scanning') return
  scanState.value = 'scanning'
  scanMsg.value = ''
  try {
    // 边缘函数按文件路由，必须走基础路径 + 查询参数（子路径会落到 SPA 兜底返回 HTML）
    const { data } = await axios.get('/image-records', { baseURL: '', params: { 'cnb-assets': 1 } })
    if (data.code === 0) {
      orphans.value = data.data?.orphans || []
      scanMeta.value = {
        scanned: data.data?.scanned || 0,
        otherTypes: data.data?.otherTypes || 0,
        truncated: !!(data.data?.truncated || data.data?.orphansTruncated),
      }
      scanState.value = 'done'
    } else {
      scanMsg.value = data.msg || '扫描失败'
      scanState.value = 'error'
    }
  } catch (e: unknown) {
    // 兜底：非 2xx 响应也尽量取出服务端给出的具体原因
    const err = e as { response?: { data?: { msg?: string } } }
    scanMsg.value = err?.response?.data?.msg || '扫描失败，请检查令牌权限后重试'
    scanState.value = 'error'
  }
}

// 清理走 node 端删除接口（paths 直传，单次 ≤50 自动分批），删除前二次确认
const purgeOrphans = async () => {
  if (orphanPurging.value || orphans.value.length === 0) return
  if (!window.confirm(`将永久删除 CNB 上的 ${orphans.value.length} 个孤儿文件，不可恢复。确定继续？`)) return
  orphanPurging.value = true
  let failed = 0
  try {
    for (let i = 0; i < orphans.value.length; i += 50) {
      const paths = orphans.value.slice(i, i + 50).map((o) => o.path)
      try {
        // node 端点：走 axios 默认 baseURL /api
        const { data } = await axios.post('/file/delete-cnb', { paths })
        if (data.code === 0) failed += (data.data?.failed || []).length
        else failed += paths.length
      } catch {
        failed += paths.length
      }
    }
    const okCount = orphans.value.length - failed
    if (failed === 0) toast.success(`已清理 ${okCount} 个孤儿文件`)
    else toast.warning(`已清理 ${okCount} 个，${failed} 个删除失败（可重新扫描后重试）`)
    // 同步刷新：孤儿已删除，立即更新侧栏存储卡的图片总量与占用
    await fetchUsage(true)
    await scanOrphans()
  } finally {
    orphanPurging.value = false
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
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">上传压缩与外观偏好（保存在本机浏览器）</p>
      </div>

      <!-- 压缩模式：原始 / 质量档位 -->
      <div class="card p-6">
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
          <div class="min-w-0 flex-1">
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

      <!-- 文件命名规则 + 默认复制格式 -->
      <div class="card p-6">
        <div class="grid gap-6 md:grid-cols-2">
          <div>
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

          <div>
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
        </div>
      </div>

      <!-- 孤儿文件扫描：CNB 平台资产清单 vs 上传记录对比 -->
      <div class="card p-6">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400">
              <SearchCode class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <p class="whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">孤儿文件扫描</p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                对比 CNB 平台资产清单与上传记录（含回收站），找出仓库中已无记录引用的图片；只读不删，清理前二次确认
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              @click="scanOrphans"
              :disabled="scanState === 'scanning'"
              class="flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60"
              :class="
                scanState === 'scanning'
                  ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                  : 'brand-gradient text-white shadow-md shadow-indigo-500/25 hover:opacity-90'
              "
            >
              {{ scanState === 'scanning' ? '扫描中…' : '扫描' }}
            </button>
          </div>
        </div>

        <!-- 扫描失败 -->
        <p v-if="scanState === 'error'" class="mt-3 text-xs font-semibold text-red-500 dark:text-red-400">
          {{ scanMsg }}
        </p>

        <!-- 扫描结果 -->
        <div v-if="scanState === 'done'" class="mt-4">
          <p class="text-xs font-semibold text-gray-600 dark:text-gray-300">
            已扫描 {{ scanMeta?.scanned || 0 }} 个平台资产
            <template v-if="scanMeta?.otherTypes">
              （{{ scanMeta.otherTypes }} 个非图片附件不计入）
            </template>
            ，发现
            <span :class="orphans.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
              {{ orphans.length }} 个孤儿文件
            </span>
            <template v-if="hiddenThumbCount > 0">（其中 {{ hiddenThumbCount }} 个为缩略图，随主图清理）</template>
            <template v-if="orphans.length > 0">，共 {{ formatCompactSize(orphanTotalSize) }}</template>
          </p>
          <p v-if="scanMeta?.truncated" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
            资产数量超过单次扫描上限，结果可能不完整，可多次执行清理后重新扫描
          </p>

          <!-- 孤儿卡片网格：样式与图片列表一致 -->
          <div
            v-if="displayOrphans.length > 0"
            class="mt-3 grid max-h-[26rem] grid-cols-2 gap-3 overflow-y-auto sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4"
          >
            <div v-for="orphan in displayOrphans" :key="orphan.path" class="card group overflow-hidden">
              <div class="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-800">
                <a
                  :href="orphanUrl(orphan)"
                  target="_blank"
                  rel="noopener"
                  class="block h-full w-full cursor-zoom-in"
                  title="点击查看原图"
                >
                  <img
                    :src="orphanUrl(orphan)"
                    :alt="orphanName(orphan)"
                    loading="lazy"
                    decoding="async"
                    class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </a>
                <span class="absolute bottom-2.5 left-2.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                  {{ orphanExt(orphan) }}
                </span>
              </div>
              <div class="p-3">
                <p class="truncate text-xs font-semibold text-gray-800 sm:text-sm dark:text-gray-100" :title="orphan.path">
                  {{ orphanName(orphan) }}
                </p>
                <p class="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                  <span>{{ formatCompactSize(orphan.size) }}</span>
                  <span>{{ orphanDate(orphan) }}</span>
                </p>
              </div>
            </div>
          </div>

          <div v-if="orphans.length > 0" class="mt-3 flex justify-end">
            <button
              @click="purgeOrphans"
              :disabled="orphanPurging"
              class="flex h-9 items-center gap-1.5 rounded-xl bg-red-500 px-4 text-xs font-bold text-white shadow-md shadow-red-500/20 transition-all hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 class="h-3.5 w-3.5" />
              {{ orphanPurging ? '清理中…' : `清理全部孤儿文件` }}
            </button>
          </div>
        </div>
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
