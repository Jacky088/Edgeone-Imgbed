<script setup lang="ts">
import { computed, ref } from 'vue'
import axios from '@/utils/axios'
import { SearchCode, Trash2 } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useStorageUsage } from '@/composables/useStorageUsage'
import { formatCompactSize } from '@/utils/format'
import { toast } from 'vue-sonner'

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

// 结果排序（时间 / 大小，倒序）
const orphanSort = ref<'time' | 'size'>('time')

// 展示与图片列表一致的卡片网格；缩略图(_thumb.webp)与主图同生共死，主图已在列表时隐藏避免重复卡片
const displayOrphans = computed(() => {
  const visible = orphans.value.filter((o) => {
    if (!/_thumb\.webp$/.test(o.path)) return true
    const main = o.path.replace(/_thumb\.webp$/, '')
    return !orphans.value.some((x) => x.path === main)
  })
  return [...visible].sort((a, b) => {
    if (orphanSort.value === 'size') return (b.size || 0) - (a.size || 0)
    return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
  })
})
const hiddenThumbCount = computed(() => orphans.value.length - displayOrphans.value.length)

// 部分勾选清理（Set 内部变更不触发响应式，用版本号驱动 computed）
const selectedOrphans = ref<Set<string>>(new Set())
const orphanSelectionVersion = ref(0)
const isSelectedOrphan = (path: string) => selectedOrphans.value.has(path)
const toggleOrphan = (path: string) => {
  if (selectedOrphans.value.has(path)) selectedOrphans.value.delete(path)
  else selectedOrphans.value.add(path)
  orphanSelectionVersion.value++
}
const clearOrphanSelection = () => {
  selectedOrphans.value.clear()
  orphanSelectionVersion.value++
}
const selectedOrphanCount = computed(() => {
  void orphanSelectionVersion.value
  return selectedOrphans.value.size
})
// 勾选主图清理时连带其缩略图（_thumb.webp 与主图同生共死）
const expandSelectedWithThumbs = (): OrphanAsset[] => {
  const all = new Map(orphans.value.map((o) => [o.path, o]))
  const out: OrphanAsset[] = []
  const push = (p: string) => {
    const o = all.get(p)
    if (o && !out.some((x) => x.path === p)) out.push(o)
  }
  for (const p of selectedOrphans.value) {
    push(p)
    if (!/_thumb\.webp$/.test(p)) push(`${p}_thumb.webp`)
  }
  return out
}

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
      clearOrphanSelection()
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

// 清理走 node 端删除接口（paths 直传，单次 ≤50 自动分批）；范围：全部 / 勾选项（连带缩略图）
// 经 ConfirmDialog 应用内确认后执行，window.confirm 已弃用（与全站弹窗风格统一）
const purgeConfirm = ref<'selected' | 'all' | null>(null)

const purgeOrphans = async () => {
  if (orphanPurging.value || !purgeConfirm.value) return
  const scope = purgeConfirm.value
  const targets = scope === 'all' ? orphans.value : expandSelectedWithThumbs()
  const paths = targets.map((o) => o.path)
  if (paths.length === 0) {
    purgeConfirm.value = null
    return
  }
  orphanPurging.value = true
  let failed = 0
  try {
    for (let i = 0; i < paths.length; i += 50) {
      const batch = paths.slice(i, i + 50)
      try {
        // node 端点：走 axios 默认 baseURL /api（多存储路由，S3 路径带 s3-{id}/ 标记同样可用）
        const { data } = await axios.post('/file/delete', { paths: batch })
        if (data.code === 0) failed += (data.data?.failed || []).length
        else failed += batch.length
      } catch {
        failed += batch.length
      }
    }
    const okCount = paths.length - failed
    if (failed === 0) toast.success(`已清理 ${okCount} 个孤儿文件`)
    else toast.warning(`已清理 ${okCount} 个，${failed} 个删除失败（可重新扫描后重试）`)
    clearOrphanSelection()
    // 同步刷新：孤儿已删除，立即更新侧栏存储卡的图片总量与占用
    await fetchUsage(true)
    await scanOrphans()
  } finally {
    orphanPurging.value = false
    purgeConfirm.value = null
  }
}
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white">
          <SearchCode class="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          孤儿清理
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">扫描并清理仓库中已无记录引用的图片（孤儿文件）</p>
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
                对比 CNB 平台资产清单与上传记录（含回收站），找出仓库中已无记录引用的图片；只读不删，清理前二次确认（仅覆盖 CNB 存储，S3 桶暂不支持）
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <!-- 结果排序切换 -->
            <div
              v-if="scanState === 'done' && orphans.length > 0"
              class="flex h-9 items-center gap-0.5 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                @click="orphanSort = 'time'"
                class="rounded-lg px-2.5 text-xs font-bold transition-colors"
                :class="orphanSort === 'time' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              >
                时间
              </button>
              <button
                @click="orphanSort = 'size'"
                class="rounded-lg px-2.5 text-xs font-bold transition-colors"
                :class="orphanSort === 'size' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
              >
                大小
              </button>
            </div>
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
                <!-- 勾选清理 -->
                <label
                  class="absolute left-2.5 top-2.5 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow-sm backdrop-blur transition-opacity dark:bg-gray-900/80"
                  :class="isSelectedOrphan(orphan.path) ? 'opacity-100 ring-2 ring-indigo-500' : 'opacity-80 group-hover:opacity-100'"
                  @click.stop
                  title="勾选后可只清理选中项"
                >
                  <input
                    type="checkbox"
                    :checked="isSelectedOrphan(orphan.path)"
                    @change="toggleOrphan(orphan.path)"
                    class="h-4 w-4 cursor-pointer accent-indigo-600"
                  />
                </label>
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

          <div v-if="orphans.length > 0" class="mt-3 flex flex-wrap justify-end gap-2">
            <button
              v-if="selectedOrphanCount > 0"
              @click="purgeConfirm = 'selected'"
              :disabled="orphanPurging"
              class="flex h-9 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 text-xs font-bold text-red-500 transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Trash2 class="h-3.5 w-3.5" />
              清理选中 ({{ selectedOrphanCount }})
            </button>
            <button
              @click="purgeConfirm = 'all'"
              :disabled="orphanPurging"
              class="flex h-9 items-center gap-1.5 rounded-xl bg-red-500 px-4 text-xs font-bold text-white shadow-md shadow-red-500/20 transition-all hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 class="h-3.5 w-3.5" />
              {{ orphanPurging ? '清理中…' : '清理全部孤儿文件' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 孤儿清理确认弹窗（替代原生 confirm，与全站弹窗风格统一） -->
      <ConfirmDialog
        :open="purgeConfirm !== null"
        :title="`将永久删除 CNB 上的 ${purgeConfirm === 'selected' ? selectedOrphanCount : orphans.length} 个孤儿文件？`"
        description="删除不可恢复；勾选主图清理时会连带其缩略图。"
        confirm-text="删除"
        :loading="orphanPurging"
        @confirm="purgeOrphans"
        @cancel="purgeConfirm = null"
      />
    </div>
  </AppShell>
</template>
