<script setup lang="ts">
import type { ButtonHTMLAttributes } from 'vue'

interface Props {
  class?: string
  type?: ButtonHTMLAttributes['type']
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  type: 'button',
  disabled: false,
})
</script>

<template>
  <button data-slot="button" :type="type" :disabled="disabled" :class="$props.class">
    <slot />
  </button>
</template>
