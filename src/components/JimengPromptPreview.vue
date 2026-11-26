<script>
import { marked } from 'marked'
import { Copy } from 'lucide-vue-next'
import ProjectMarkdown from './ProjectMarkdown.vue'

function promptSections(markdown) {
  const sections = []
  let section = { source: '', prompt: '' }
  let prose = false
  function finish() {
    if (section.source.trim()) sections.push(section)
    section = { source: '', prompt: '' }
    prose = false
  }
  for (const token of marked.lexer(markdown)) {
    if (token.type === 'code' || token.type === 'blockquote') {
      finish()
      sections.push({ source: token.raw, prompt: token.text })
      continue
    }
    if (token.type === 'heading') finish()
    if (token.type === 'paragraph' && /^可复制提示词[：:]\s*$/.test(token.text)) {
      finish()
      section.source = token.raw
      finish()
      prose = true
      continue
    }
    if (!prose && token.type === 'paragraph' && /^生成/.test(token.text)) {
      finish()
      prose = true
    }
    section.source += token.raw
    if (prose) section.prompt += token.raw
  }
  finish()
  return sections
}

export default {
  components: { Copy, ProjectMarkdown },
  props: { source: String, file: String },
  data() { return { feedback: null } },
  computed: { sections() { return promptSections(this.source) } },
  methods: {
    async copy(section, index) {
      try {
        await navigator.clipboard.writeText(section.prompt.trim())
        this.feedback = { index, label: '已复制' }
      } catch {
        this.feedback = { index, label: '复制失败' }
      }
    },
  },
}
</script>
<template>
  <section v-for="(section, i) in sections" :key="i">
    <div v-if="section.prompt.trim()" class="prompt-actions">
      <button type="button" class="secondary" @click="copy(section, i)">
        <Copy :size="14" /><span aria-live="polite">{{ $t(feedback?.index === i ? feedback.label : '复制提示词') }}</span>
      </button>
    </div>
    <ProjectMarkdown :source="section.source" :file="file" show-images />
  </section>
</template>
<style scoped>
.prompt-actions { display:flex; justify-content:flex-end; margin:8px 0 4px }
</style>
