<script>
import { Pencil } from 'lucide-vue-next'

export default {
  components: { Pencil },
  props: {
    draft: { type: String, default: null },
    busy: Boolean,
  },
  emits: ['edit', 'cancel', 'save', 'update:draft'],
}
</script>

<template>
  <form @submit.prevent="$emit('save')">
    <div class="asset-story-actions">
      <span>README.md</span>
      <div v-if="draft !== null" class="dialog-actions">
        <button type="button" class="secondary" :disabled="busy" @click="$emit('cancel')">{{ $t('取消') }}</button>
        <button class="primary" :disabled="busy">{{ $t('保存') }}</button>
      </div>
      <button v-else type="button" class="secondary" :disabled="busy" @click="$emit('edit')">
        <Pencil :size="15" aria-hidden="true" />{{ $t('编辑') }}
      </button>
    </div>
    <div class="asset-story-panel">
      <textarea v-if="draft !== null" :value="draft" aria-label="README.md" :disabled="busy"
        @input="$emit('update:draft', $event.target.value)"></textarea>
      <slot v-else />
    </div>
  </form>
</template>
