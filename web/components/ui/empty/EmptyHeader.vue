<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});
</script>

<template>
  <div
    data-slot="empty-header"
    :class="
      cn('flex max-w-sm flex-col items-center gap-2 text-center', props.class)
    "
  >
    <slot />
  </div>
</template>
