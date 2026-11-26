<script>
import { ChevronRight, ExternalLink, Film } from 'lucide-vue-next'
import { ElOption, ElSelect } from 'element-plus'
import ScriptVersionDiff from '@/components/ScriptVersionDiff.vue'
import AssetStoryEditor from '@/components/AssetStoryEditor.vue'
import ProjectMarkdown from '@/components/ProjectMarkdown.vue'
import { projectFileUrl } from '@/service/project-markdown.js'

export default {
  components: { ChevronRight, ExternalLink, Film, ProjectMarkdown, AssetStoryEditor, ScriptVersionDiff, ElOption, ElSelect },
  data() {
    return { scripts: [], active: null, file: '', article: '', error: '', loading: true, loaded: false, draft: null, saving: false, revision: 0, version: '', historic: null, versionRevision: 0 }
  },
  async mounted() {
    try {
      const response = await fetch('/api/scripts', { cache: 'no-store' })
      if (!response.ok) throw new Error(this.$t('无法读取剧本目录'))
      this.scripts = await response.json()
      if (this.scripts.length) await this.select(this.scripts[0])
    } catch (cause) {
      this.error = cause.message
    } finally {
      this.loading = false
    }
  },
  beforeUnmount() {
    this.revision++
    this.versionRevision++
  },
  methods: {
    title(name) {
      if (name === 'opening') return this.$t('片头')
      if (name === 'ending') return this.$t('片尾')
      return name.replace(/^\d{3}-/, '')
    },
    async select(script) {
      this.active = script
      await this.open(script.documents[0])
    },
    async save() {
      this.saving = true
      this.error = ''
      try {
        const response = await fetch(projectFileUrl(this.file), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ original: this.article, markdown: this.draft }),
        })
        if (!response.ok) throw new Error(await response.text())
        this.article = this.draft
        this.draft = null
        const listing = await fetch('/api/scripts', { cache: 'no-store' })
        if (listing.ok) {
          const updated = (await listing.json()).find(script => script.name === this.active.name)
          if (updated) this.active.history = updated.history
        }
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.saving = false
      }
    },
    async selectVersion(version) {
      const revision = ++this.versionRevision
      this.version = version
      this.historic = null
      this.error = ''
      if (!version) return
      const file = 'scripts/' + this.active.name + '/archive/' + version
      try {
        const response = await fetch(projectFileUrl(file), { cache: 'no-store' })
        if (!response.ok) throw new Error(this.$t('无法读取 {file}', { file }))
        const historic = await response.text()
        if (revision === this.versionRevision) this.historic = historic
      } catch (cause) {
        if (revision === this.versionRevision) {
          this.version = ''
          this.error = cause.message
        }
      }
    },
    async open(document) {
      this.selectVersion('')
      const revision = ++this.revision
      this.error = ''
      this.loaded = false
      this.article = ''
      this.file = document ? 'scripts/' + this.active.name + '/' + document : ''
      if (!this.file) return
      try {
        const response = await fetch(projectFileUrl(this.file), { cache: 'no-store' })
        if (!response.ok) throw new Error(this.$t('无法读取 {file}', { file: this.file }))
        const article = await response.text()
        if (revision === this.revision) {
          this.article = article
          this.loaded = true
        }
      } catch (cause) {
        if (revision === this.revision) this.error = cause.message
      }
    },
    videoUrl(video) {
      return '/api/scripts?video=' + encodeURIComponent(this.active.name + '/' + video)
    },
  },
}
</script>

<template>
  <section class="content">
    <div class="heading"><h1>{{ $t('剧本') }}</h1></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!loading && !error && !scripts.length">{{ $t('暂无剧本') }}</p>
    <div v-if="active" class="settings-layout">
      <nav class="settings-index" :aria-label="$t('剧本目录')">
        <button v-for="script in scripts" :key="script.name"
          :disabled="draft !== null || saving"
          :class="{ current: active.name === script.name }"
          :aria-current="active.name === script.name ? 'page' : undefined" @click="select(script)">
          {{ title(script.name) }}<ChevronRight :size="14" />
        </button>
      </nav>
      <div class="settings-reader">
        <AssetStoryEditor v-model:draft="draft" :label="file" :busy="saving || !loaded || Boolean(version)" @edit="draft = article" @cancel="draft = null" @save="save">
          <template #actions>
            <ElSelect v-if="file === 'scripts/' + active.name + '/index.md' && active.history.length"
              class="script-version-select" :empty-values="[null, undefined]" :model-value="version" :aria-label="$t('历史版本')"
              :disabled="draft !== null || saving || !loaded" @change="selectVersion">
              <ElOption :label="$t('当前版本')" value="" />
              <ElOption v-for="item in active.history" :key="item" :label="item" :value="item" />
            </ElSelect>
          </template>
          <template #header>
            <header :key="active.name" class="script-header">
              <h2>{{ title(active.name) }}</h2>
              <div v-if="active.documents.length > 1" class="script-links">
                <button v-for="document in active.documents" :key="document" type="button" :disabled="draft !== null || saving"
                  :aria-pressed="file.endsWith('/' + active.name + '/' + document)" @click="open(document)">
                  {{ document === 'index.md' ? $t('剧本') : document.replace(/\.(md|markdown)$/i, '') }}
                </button>
              </div>
              <div v-if="active.videos.length" class="script-disclosures">
                <details class="script-disclosure" v-if="active.videos.length">
                  <summary>
                    <Film :size="17" aria-hidden="true" />
                    <span>{{ $t('成片') }}</span>
                    <span class="script-count">{{ active.videos.length }}</span>
                    <ChevronRight class="script-chevron" :size="16" aria-hidden="true" />
                  </summary>
                  <div class="script-file-list">
                    <a v-for="video in active.videos" :key="video" :href="videoUrl(video)" target="_blank" rel="noopener">
                      <span>{{ video }}</span><ExternalLink :size="14" aria-hidden="true" />
                    </a>
                  </div>
                </details>
              </div>
            </header>
          </template>
          <ScriptVersionDiff v-if="version && historic !== null" :current="article" :historic="historic" :version="version" />
          <p v-else-if="version" role="status">{{ $t('正在读取历史版本') }}</p>
          <ProjectMarkdown v-else-if="file" :source="article" :file="file" show-images />
          <p v-else>{{ $t('暂无剧本') }}</p>
        </AssetStoryEditor>
      </div>
    </div>
  </section>
</template>

<style scoped>
.script-header { display: grid; gap: 12px; padding-bottom: 16px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.script-version-select {
  width: 132px;
  --el-select-border-color-hover: #a9a5d9;
  --el-select-input-focus-border-color: var(--accent);
}
.script-version-select :deep(.el-select__wrapper) {
  min-height: 38px;
  padding-inline: 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 650;
}
.script-version-select :deep(.el-select__wrapper:not(.is-disabled):not(.is-hovering):not(.is-focused)) {
  box-shadow: 0 0 0 1px var(--line) inset;
}
.script-version-select :deep(.el-select__selected-item),
.script-version-select :deep(.el-select__caret) {
  color: #434b62;
}
.script-header h2 { margin: 0; }
.script-links { display: flex; flex-wrap: wrap; gap: 8px; }
.script-disclosures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  align-items: start;
  gap: 12px;
}
.script-disclosure { min-width: 0; border: 1px solid var(--line); border-radius: 12px; }
.script-disclosure summary {
  display: flex;
  align-items: center;
  gap: 8px;
  list-style: none;
  cursor: pointer;
  padding: 12px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 600;
}
.script-disclosure summary::-webkit-details-marker { display: none; }
.script-disclosure summary:hover, .script-disclosure[open] summary { background: var(--accent-bg); color: var(--accent); }
.script-disclosure[open] summary { border-radius: 11px 11px 0 0; }
.script-disclosure[open] .script-chevron { transform: rotate(90deg); }
.script-count {
  margin-inline-start: auto;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.script-file-list { display: grid; gap: 4px; padding: 8px; }
.script-file-list a, .script-file-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: start;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.script-file-list svg { flex-shrink: 0; }
.script-file-list :is(a, button:not(:disabled)):hover, .script-file-list [aria-pressed="true"] {
  color: var(--accent);
  background: var(--accent-bg);
}
.script-links button, .script-links a {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  color: var(--ink);
  padding: 6px 12px;
  font: inherit;
  text-decoration: none;
}
.script-links button:hover, .script-links a:hover, .script-links [aria-pressed="true"] {
  color: var(--accent);
  background: var(--accent-bg);
}
</style>
