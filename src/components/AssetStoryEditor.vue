<script>
import { Pencil } from 'lucide-vue-next'

export default {
  components: { Pencil },
  props: {
    draft: { type: String, default: null },
    busy: Boolean,
    readOnly: Boolean,
    label: { type: String, default: 'README.md' },
  },
  emits: ['edit', 'cancel', 'save', 'update:draft'],
}
</script>

<template>
  <form @submit.prevent="$emit('save')">
    <div v-if="label" class="asset-story-actions">
      <span>{{ label }}</span>
      <div class="dialog-actions">
        <slot name="actions" />
        <div v-if="draft !== null" class="dialog-actions">
          <button type="button" class="secondary" :disabled="busy" @click="$emit('cancel')">{{ $t('取消') }}</button>
          <button class="primary" :disabled="busy">{{ $t('保存') }}</button>
        </div>
        <button v-else-if="!readOnly" type="button" class="secondary" :disabled="busy" @click="$emit('edit')">
          <Pencil :size="15" aria-hidden="true" />{{ $t('编辑') }}
        </button>
      </div>
    </div>
    <slot name="header" />
    <div class="asset-story-panel">
      <textarea v-if="draft !== null" :value="draft" :aria-label="label" :disabled="busy"
        @input="$emit('update:draft', $event.target.value)"></textarea>
      <slot v-else />
    </div>
  </form>
</template>
