<script>
import { X } from 'lucide-vue-next'
import AssetStoryEditor from './AssetStoryEditor.vue'
import JimengPromptPreview from './JimengPromptPreview.vue'
import ProjectMarkdown from './ProjectMarkdown.vue'
import { projectFileUrl } from '@/service/project-markdown.js'

export default {
  components: { X, AssetStoryEditor, JimengPromptPreview, ProjectMarkdown },
  data() {
    return { revision: 0, doc: null, article: '', draft: null, busy: false, error: '' }
  },
  mounted() {
    import.meta.hot?.on('workbench:storyboard:changed', this.reload)
  },
  beforeUnmount() {
    import.meta.hot?.off('workbench:storyboard:changed', this.reload)
  },
  methods: {
    async reload() {
      if (!this.$refs.dialog.open || this.draft !== null || this.busy) return
      const doc = this.doc
      const revision = ++this.revision
      try {
        const response = await fetch(projectFileUrl(doc.file), { cache: 'no-store' })
        if (!response.ok) throw new Error()
        const article = await response.text()
        if (this.doc === doc && this.draft === null && revision === this.revision) {
          this.article = article
          this.error = ''
        }
      } catch {
        if (this.doc === doc && revision === this.revision) this.error = '读取失败'
      }
    },
    async open(doc) {
      this.doc = doc
      this.article = ''
      this.draft = null
      this.error = ''
      this.busy = true
      this.$refs.dialog.showModal()
      try {
        const response = await fetch(projectFileUrl(doc.file))
        if (!response.ok) throw new Error()
        this.article = await response.text()
      } catch {
        this.error = '读取失败'
      } finally {
        this.busy = false
      }
    },
    close() {
      if (this.busy) return
      if (this.draft !== null && this.draft !== this.article && !window.confirm(this.$t('放弃未保存的修改？'))) return
      this.$refs.dialog.close()
    },
    async save() {
      this.busy = true
      this.error = ''
      try {
        const response = await fetch(projectFileUrl(this.doc.file), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ original: this.article, markdown: this.draft }),
        })
        if (!response.ok) {
          this.error = response.status === 409 ? '文件已更新，请复制草稿后重新打开' : '保存失败'
          return
        }
        this.article = this.draft
        this.draft = null
      } catch {
        this.error = '保存失败'
      } finally {
        this.busy = false
      }
    },
  },
}
</script>
<template>
  <dialog ref="dialog" class="dialog storyboard-document" aria-labelledby="storyboard-document-title" @cancel.prevent="close">
    <template v-if="doc">
      <header><strong id="storyboard-document-title">{{ doc.name }}</strong><button class="secondary" :disabled="busy" :aria-label="$t('关闭')" @click="close"><X :size="18" /></button></header>
      <p v-if="error" role="alert">{{ $t(error) }}</p>
      <AssetStoryEditor v-model:draft="draft" :label="doc.file" :busy="busy || error === '读取失败'"
        @edit="draft = article" @cancel="draft = null; reload()" @save="save">
        <JimengPromptPreview v-if="doc.name === '即梦.md'" :source="article" :file="doc.file" />
        <ProjectMarkdown v-else :source="article" :file="doc.file" show-images />
      </AssetStoryEditor>
    </template>
  </dialog>
</template>
<style scoped>
dialog.storyboard-document { width:min(860px,92vw); padding:20px }
header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px }
.storyboard-document :deep(.asset-story-panel) { max-height:65dvh; overflow:auto }
.storyboard-document :deep(textarea) { min-height:45dvh }
</style>
