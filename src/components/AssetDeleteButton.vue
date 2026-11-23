<script>
import { ElButton, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/message-box/style/css'
import { Trash2 } from 'lucide-vue-next'

export default {
  components: { ElButton, Trash2 },
  props: {
    assetName: { type: String, required: true },
    busy: Boolean,
  },
  emits: ['confirm'],
  data() {
    return { confirming: false }
  },
  methods: {
    async confirmDelete(event) {
      if (this.busy || this.confirming) return
      const dialog = event.currentTarget.closest('dialog')
      this.confirming = true
      try {
        await ElMessageBox.confirm(
          this.$t('将永久删除「{name}」的整个文件夹，包括历史版本。', { name: this.assetName }),
          this.$t('确认删除'),
          {
            appendTo: dialog || undefined,
            customClass: 'asset-delete-message',
            type: 'warning',
            confirmButtonType: 'danger',
            confirmButtonText: this.$t('确认删除'),
            cancelButtonText: this.$t('取消'),
            closeOnClickModal: false,
            autofocus: false,
          },
        )
        this.$emit('confirm')
      } catch (action) {
        if (action !== 'cancel' && action !== 'close') throw action
      } finally {
        this.confirming = false
      }
    },
  },
}
</script>

<template>
  <ElButton type="danger" plain class="overview-delete-button" :disabled="busy || confirming" @click="confirmDelete">
    <template #icon><Trash2 :size="15" aria-hidden="true" /></template>
    {{ $t('删除') }}
  </ElButton>
</template>
