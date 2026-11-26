<script>
import { renderProjectMarkdown } from '@/service/project-markdown.js'

export default {
  props: {
    source: { type: String, required: true },
    file: { type: String, default: '' },
    showImages: Boolean,
  },
  computed: {
    html() {
      const options = this.showImages ? { ADD_ATTR: ['loading'] } : { FORBID_TAGS: ['img'] }
      return renderProjectMarkdown(this.source, this.file, options)
    },
  },
}
</script>

<template>
  <article class="markdown" v-html="html"></article>
</template>

<style scoped>
.markdown { font-size: 14px; line-height: 1.68; overflow-wrap: anywhere; }
.markdown :deep(h1) { font-size: 24px; }
.markdown :deep(h2) { font-size: 18px; }
.markdown :deep(a) { color: var(--accent); }
.markdown :deep(img) { display: block; max-width: 100%; height: auto; border-radius: 7px; }
.markdown :deep(.markdown-table) { max-width: 100%; margin-block: 12px; overflow-x: auto; }
.markdown :deep(table) { width: 100%; border-collapse: collapse; }
.markdown :deep(th), .markdown :deep(td) { padding: 8px 12px; border: 1px solid var(--line); vertical-align: top; }
.markdown :deep(th) { background: #eef1f5; }
.markdown :deep(th:not([align])) { text-align: start; }
</style>
