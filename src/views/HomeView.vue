<script setup lang="ts">
import FileUploader from '@/components/public/FileUploader.vue'
import ResultCard from '@/components/ResultCard.vue'
import AppShell from '@/components/layout/AppShell.vue'
import { ref } from 'vue'
import type { UploadResult } from '@/utils/formatLinks'

// 批量上传：逐张收集上传结果
const results = ref<UploadResult[]>([])

const handleUploadSuccess = (info: UploadResult) => {
  results.value.push(info)
}
</script>

<template>
  <AppShell>
    <div class="flex flex-col gap-6">
      <!-- 上传组件 - 精致卡片 -->
      <div class="glass-card-premium overflow-hidden rounded-3xl p-6 shadow-2xl shadow-blue-500/5 ring-1 ring-white/20 dark:shadow-blue-500/10 dark:ring-white/5">
        <FileUploader
          @update:uploadInfo="handleUploadSuccess"
          :maxHeight="5000"
          :maxWidth="5000"
          :quality="0.7"
          :generateThumbnail="true"
          :thumbnailMaxWidth="400"
          :thumbnailMaxHeight="800"
          :thumbnailQuality="0.8"
        />
      </div>

      <!-- 上传结果列表 -->
      <Transition
        enter-active-class="transition-all duration-700 ease-out"
        enter-from-class="opacity-0 translate-y-12 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-300 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-8 scale-95"
      >
        <div v-if="results.length" class="space-y-6">
          <ResultCard v-for="(info, idx) in results" :key="idx + '-' + (info.name || idx)" :info="info" />
        </div>
      </Transition>
    </div>
  </AppShell>
</template>
