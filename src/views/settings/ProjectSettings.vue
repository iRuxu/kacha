<script>
import { ChevronRight } from 'lucide-vue-next'
import AssetStoryEditor from '@/components/AssetStoryEditor.vue'
import ProjectMarkdown from '@/components/ProjectMarkdown.vue'
import { projectFileUrl } from '@/service/project-markdown.js'

export default {
  components: { ChevronRight, ProjectMarkdown, AssetStoryEditor },
  data() {
    return { draft: null, original: '', saving: false, loaded: false, documents: [], active: null, article: '', error: '', revision: 0, listRevision: 0 }
  },
  computed: {
    groups() {
      const groups = new Map(['故事设定', '美术设定', '其它设定'].map(group => [group, []]))
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
    await this.refresh()
  },
  beforeUnmount() {
    this.listRevision++
    this.revision++
    import.meta.hot?.off('workbench:settings:changed', this.refresh)
    import.meta.hot?.off('workbench:scenes:changed', this.refresh)
  },
  methods: {
    async refresh() {
      const revision = ++this.listRevision
      try {
        const response = await fetch('/api/settings', { cache: 'no-store' })
        if (!response.ok) throw new Error(this.$t('无法读取设定目录'))
        const documents = await response.json()
        if (revision !== this.listRevision) return
        this.documents = documents
        const current = documents.find(doc => doc.file === this.active?.file)
        if (this.draft !== null) return
        if (documents.length) return this.open(current || documents[0], Boolean(current))
        this.revision++
        this.active = null
        this.article = ''
        this.error = ''
      } catch (cause) {
        if (revision === this.listRevision) this.error = cause.message
      }
    },
    edit() {
      this.original = this.article
      this.draft = this.article
    },
    async cancel() {
      this.draft = null
      await this.refresh()
    },
    async save() {
      this.saving = true
      try {
        const response = await fetch(projectFileUrl(this.active.file), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ original: this.original, markdown: this.draft }),
        })
        if (!response.ok) throw new Error(await response.text())
        this.article = this.draft
        this.draft = null
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.saving = false
      }
    },
    async open(document, keepArticle = false) {
      const revision = ++this.revision
      this.loaded = false
      this.active = document
      if (!keepArticle) this.article = ''
      this.error = ''
      try {
        const response = await fetch(projectFileUrl(document.file))
        if (!response.ok) throw new Error(this.$t('无法读取 {file}', { file: document.file }))
        const markdown = await response.text()
        if (revision === this.revision) {
          this.article = markdown
          this.loaded = true
        }
      } catch (cause) {
        if (revision === this.revision) this.error = cause.message
      }
    },
  },
}
</script>

<template>
  <section class="content">
    <div class="heading"><h1>{{ $t('设定') }}</h1></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="settings-layout">
      <nav class="settings-index" :aria-label="$t('设定目录')">
        <div v-for="[group, items] in groups" :key="group">
          <h2>{{ $t(group) }}</h2>
          <button v-for="document in items" :key="document.file" :disabled="draft !== null || saving" :class="{ current: active?.file === document.file }"
            :aria-current="active?.file === document.file ? 'page' : undefined" @click="open(document)">
            {{ document.title }}<ChevronRight :size="14" />
          </button>
        </div>
      </nav>
      <div v-if="active" class="settings-reader">
        <AssetStoryEditor v-model:draft="draft" :label="active.file" :busy="saving || !loaded" @edit="edit" @cancel="cancel" @save="save">
          <ProjectMarkdown :source="article" :file="active.file" show-images />
        </AssetStoryEditor>
      </div>
    </div>
  </section>
</template>
