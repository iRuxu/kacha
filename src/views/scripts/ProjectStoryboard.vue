<script>
import { rememberWork } from '@/service/resume.js'
import { ElOption, ElSelect } from 'element-plus'
import StoryboardDocument from '@/components/StoryboardDocument.vue'
import { FileText, X } from 'lucide-vue-next'

export default {
  components: { FileText, StoryboardDocument, ElOption, ElSelect, X },
  data() {
    return { revision: 0, restorePending: true, episodes: [], selected: '', loading: true, error: false, preview: null }
  },
  computed: {
    episode() { return this.episodes.find(e => e.name === this.selected) },
  },
  async mounted() {
    import.meta.hot?.on('workbench:storyboard:changed', this.refresh)
    await this.refresh()
  },
  beforeUnmount() {
    this.revision++
    import.meta.hot?.off('workbench:storyboard:changed', this.refresh)
  },
  updated() {
    if (!this.restorePending || !this.$refs.board) return
    this.restorePending = false
    const group = [...this.$refs.board.querySelectorAll('[data-group]')].find(el =>
      el.dataset.scene === this.$route.query.scene && el.dataset.group === this.$route.query.group)
    group?.scrollIntoView({ block: 'start' })
  },
  methods: {
    async refresh() {
      const revision = ++this.revision
      try {
        const response = await fetch('/api/storyboard')
        if (!response.ok) throw new Error()
        const episodes = await response.json()
        if (revision !== this.revision) return
        this.episodes = episodes
        this.error = false
        this.selected = (this.episodes.find(e => e.name === (this.selected || this.$route.query.episode)) || this.episodes.find(e => /^\d/.test(e.name) && e.scenes.length) || this.episodes[0])?.name || ''
        if (this.preview) {
          const key = this.preview.url.split('&modified=')[0]
          this.preview = this.episode?.scenes.flatMap(scene => scene.groups.flatMap(group => group.media))
            .find(media => media.url.split('&modified=')[0] === key) || null
          if (!this.preview) this.$refs.viewer.close()
        }
      } catch { if (revision === this.revision) this.error = true }
      finally { this.loading = false }
    },
    remember(scene, group) {
      if (!this.selected) return
      const query = { episode: this.selected }
      const labels = [this.title(this.selected)]
      if (scene) { query.scene = scene; labels.push(scene) }
      if (group) { query.group = group; if (group !== scene) labels.push(group) }
      rememberWork('storyboard', query, labels)
    },
    title(name) { return name === 'opening' ? this.$t('片头') : name === 'ending' ? this.$t('片尾') : name },
    open(media) { this.preview = media; this.$refs.viewer.showModal() },
  },
}
</script>

<template>
  <section class="storyboard-page">
    <div class="board-tools">
      <h1>{{ $t('分镜') }}</h1>
      <ElSelect v-model="selected" :aria-label="$t('分集')" style="width:210px" @change="$refs.list.scrollTop = 0; remember()">
        <template #label="{ label }"><span class="episode-number">{{ label.match(/^\d+/)?.[0] }}</span>{{ label.replace(/^\d+/, '') }}</template>
        <ElOption v-for="e in episodes" :key="e.name" :label="title(e.name)" :value="e.name">
          <span class="episode-number">{{ e.name.match(/^\d+/)?.[0] }}</span>{{ title(e.name).replace(/^\d+/, '') }}
        </ElOption>
      </ElSelect>
    </div>
    <div ref="list" class="board-list">
      <p v-if="error || loading || !episode?.scenes.length">{{ $t(error ? '读取失败' : loading ? '加载中' : '暂无分镜') }}</p>
      <div v-else ref="board">
        <section v-for="scene in episode.scenes" :key="scene.name" class="board-scene">
          <h2>{{ scene.name }}</h2>
          <div v-for="group in scene.groups" :key="group.name" class="board-group" :data-scene="scene.name" :data-group="group.name" @click.capture="remember(scene.name, group.name)" @focusin="remember(scene.name, group.name)">
            <div class="group-documents">
              <h3 v-if="group.name !== scene.name">{{ group.name }}</h3>
              <button v-for="doc in group.documents" :key="doc.file" @click="$refs.documentEditor.open(doc)"><FileText :size="14" />{{ doc.name }}</button>
            </div>
            <div class="board-strip">
              <article v-for="m in group.media" :key="m.url">
                <video v-if="m.video" :src="m.url" controls preload="metadata" :aria-label="m.name" />
                <button v-else @click="open(m)"><img :src="m.url" :alt="m.name" loading="lazy" draggable="false" /></button>
                <footer><b v-if="m.primary">{{ $t('默认片段') }}</b>{{ m.name.replace(/\.[^.]+$/, '') }}</footer>
              </article>
              <small v-if="!group.media.length">{{ $t('暂无分镜') }}</small>
            </div>
          </div>
        </section>
      </div>
    </div>
    <StoryboardDocument ref="documentEditor" />
    <dialog ref="viewer" @close="preview = null" @click.self="$refs.viewer.close()">
      <template v-if="preview"><header>{{ preview.name }}<button :aria-label="$t('关闭')" @click="$refs.viewer.close()"><X :size="18" /></button></header><img :src="preview.url" :alt="preview.name" /></template>
    </dialog>
  </section>
</template>

<style scoped>
.group-documents { display:flex; align-items:center; gap:8px; margin-bottom:8px }
.group-documents h3 { margin:0 4px 0 0 }
.group-documents button { display:inline-flex; align-items:center; gap:4px; border:1px solid var(--line); background:white; color:var(--muted); border-radius:8px; padding:4px 8px; font-size:12px }
.group-documents button:hover { background:var(--accent-bg); color:var(--accent) }

.episode-number { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.storyboard-page{display:flex;flex-direction:column;height:calc(100dvh - 65px);min-height:320px}
.board-tools,dialog header{display:flex;align-items:center;gap:12px}
.board-tools{background:white;padding:16px 24px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
h1,h2,h3{margin:0}h1{font-size:20px}h2{font-size:18px;margin-bottom:16px}h3{font-size:14px;color:var(--muted);margin-bottom:8px}
.board-list { flex:1; overflow:auto; padding:clamp(12px,2vw,24px) }
.board-scene { background:white; border:1px solid var(--line); border-radius:16px; padding:clamp(12px,2vw,20px) }
.board-scene + .board-scene { margin-top:24px }
.board-group { scroll-margin-top:16px }
.board-group + .board-group { margin-top:24px }
.group-documents { flex-wrap:wrap }
.board-strip { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr)); gap:12px }
.board-strip article { min-width:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:white }
dialog button { display:grid; place-items:center; padding:8px; background:white; border:0; border-radius:8px; color:var(--muted) }
.board-strip article button{display:block;width:100%;border:0;padding:0;cursor:zoom-in}.board-strip img,.board-strip video{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#151821}.board-strip footer{padding:8px 10px;font-size:12px}.board-strip b{color:var(--accent);margin-right:6px}
dialog{border:0;border-radius:12px;padding:12px;max-width:92vw}dialog::backdrop{background:#121726ba}dialog header{justify-content:space-between;margin-bottom:8px}dialog img{display:block;max-width:86vw;max-height:78vh}
</style>
