<script>
import { ChevronRight, History } from 'lucide-vue-next'

export default {
  components: { ChevronRight, History },
  props: {
    versions: { type: Array, required: true },
    group: { type: String, required: true },
  },
  methods: {
    formatTime(value) {
      if (value.length === 10) return value
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) return ''
      return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16)
    },
  },
}
</script>

<template>
  <p v-if="!versions.length" class="empty">{{ $t('还没有归档版本。') }}</p>
  <div v-else class="asset-history">
    <details v-for="version in versions" :key="version.version" :name="group" class="asset-history-item">
      <summary>
        <span class="asset-history-icon"><History :size="16" aria-hidden="true" /></span>
        <span class="asset-history-title">
          {{ version.version }}
          <time v-if="version.createdAt" :datetime="version.createdAt"
            :title="version.timeSource === 'directory' ? $t('目录创建时间') : $t('归档时间')">{{ formatTime(version.createdAt) }}</time>
          <slot name="description" :version="version" />
        </span>
        <ChevronRight class="asset-history-arrow" :size="17" aria-hidden="true" />
      </summary>
      <div class="version-content">
        <slot :version="version" />
      </div>
    </details>
  </div>
</template>
