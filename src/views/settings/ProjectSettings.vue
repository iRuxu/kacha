<script>
import { ChevronRight } from 'lucide-vue-next'
import ProjectMarkdown from '@/components/ProjectMarkdown.vue'
import { projectFileUrl } from '@/service/project-markdown.js'

export default {
  components: { ChevronRight, ProjectMarkdown },
  data() {
    return { documents: [], active: null, article: '', error: '', revision: 0 }
  },
  computed: {
    groups() {
      const groups = new Map()
      for (const document of this.documents) {
        if (!groups.has(document.group)) groups.set(document.group, [])
        groups.get(document.group).push(document)
      }
      return [...groups]
    },
  },
  async mounted() {
    import.meta.hot?.on('workbench:settings:changed', this.refresh)
    import.meta.hot?.on('workbench:scenes:changed', this.refresh)
    try {
      const response = await fetch('/api/settings')
      if (!response.ok) throw new Error(this.$t('无法读取项目设定目录'))
      this.documents = await response.json()
      if (this.documents.length) await this.open(this.documents[0])
    } catch (cause) {
      this.error = cause.message
    }
  },
  beforeUnmount() {
    this.revision++
    import.meta.hot?.off('workbench:settings:changed', this.refresh)
    import.meta.hot?.off('workbench:scenes:changed', this.refresh)
  },
  methods: {
    refresh() {
      if (this.active) return this.open(this.active, true)
    },
    async open(document, keepArticle = false) {
      const revision = ++this.revision
      this.active = document
      if (!keepArticle) this.article = ''
      this.error = ''
      try {
        const response = await fetch(projectFileUrl(document.file))
        if (!response.ok) throw new Error(this.$t('无法读取 {file}', { file: document.file }))
        const markdown = await response.text()
        if (revision === this.revision) this.article = markdown
      } catch (cause) {
        if (revision === this.revision) this.error = cause.message
      }
    },
  },
}
</script>

<template>
  <section class="content">
    <div class="heading"><h1>{{ $t('项目设定') }}</h1></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="settings-layout">
      <nav class="settings-index" :aria-label="$t('项目设定目录')">
        <div v-for="[group, items] in groups" :key="group">
          <h2>{{ $t(group) }}</h2>
          <button v-for="document in items" :key="document.file" :class="{ current: active?.file === document.file }"
            :aria-current="active?.file === document.file ? 'page' : undefined" @click="open(document)">
            {{ $t(document.title) }}<ChevronRight :size="14" />
          </button>
        </div>
      </nav>
      <div v-if="active" class="settings-reader">
        <div class="settings-source">{{ active.file }}</div>
        <ProjectMarkdown :source="article" :file="active.file" show-images />
      </div>
    </div>
  </section>
</template>
