<script>
import { ElInputTag } from 'element-plus'
import 'element-plus/es/components/input-tag/style/css'

export default {
  components: { ElInputTag },
  props: {
    modelValue: { type: Array, required: true },
  },
  emits: ['update:modelValue'],
}
</script>

<template>
  <ElInputTag class="asset-tag-editor" :model-value="modelValue" :delimiter="/[\s,，]+/"
    tag-type="primary" :placeholder="$t('输入后按空格或回车')"
    @update:model-value="$emit('update:modelValue', [...new Set($event)])" />
</template>

<style scoped>
.asset-tag-editor.el-input-tag {
  --el-input-tag-input-focus-border-color: var(--focus-border);
}
</style>
