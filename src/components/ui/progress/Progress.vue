<script setup lang="ts">
interface Props {
  /** 0 - 100 */
  modelValue?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 0,
})

const clamped = () => Math.min(100, Math.max(0, props.modelValue ?? 0))
</script>

<template>
  <div
    data-slot="progress"
    role="progressbar"
    :aria-valuenow="clamped()"
    aria-valuemin="0"
    aria-valuemax="100"
    :class="['relative w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700', props.class]"
  >
    <div
      data-slot="progress-indicator"
      class="h-full rounded-full bg-blue-500 transition-all duration-300"
      :style="{ width: `${clamped()}%` }"
    />
  </div>
</template>
