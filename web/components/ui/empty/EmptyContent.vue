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
    data-slot="empty-content"
    :class="
      cn(
        'flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
