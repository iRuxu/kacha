<script>
import { recentWork } from '@/service/resume.js'
import { AudioLines, Box, ChevronRight, FileText, Layers3, Mountain, Users } from 'lucide-vue-next'
import { requestAsset } from '@/service/assets.js'

const metrics = [
  { route: 'scripts', label: '分集', icon: 'FileText' },
  { route: 'characters', label: '角色', icon: 'Users' },
  { route: 'scenes', label: '场景', icon: 'Mountain' },
  { route: 'props', label: '道具', icon: 'Box' },
  { route: 'other', label: '其他素材', icon: 'Layers3' },
  { route: 'audio', label: '音频', icon: 'AudioLines' },
]

export default {
  components: { AudioLines, Box, ChevronRight, FileText, Layers3, Mountain, Users },
  data() {
    return { metrics, counts: {}, resume: recentWork(), playlist: [], position: 0, videoError: false }
  },
  computed: {
    current() { return this.playlist[this.position] },
  },
  mounted() {
    if (!this.resume) this.findLatestWork()
    this.subscriptions = metrics.map(({ route }) => {
      const refresh = () => this.loadCount(route)
      const event = 'workbench:' + route + ':changed'
      import.meta.hot?.on(event, refresh)
      refresh()
      return () => import.meta.hot?.off(event, refresh)
    })
  },
  beforeUnmount() {
    this.subscriptions.forEach(unsubscribe => unsubscribe())
  },
  methods: {
    async findLatestWork() {
      try {
        const episodes = await requestAsset('storyboard')
        const latest = episodes.filter(item => /^\d{3}-/.test(item.name) && item.scenes.some(scene =>
          scene.groups.some(group => group.media.length))).sort((a, b) => b.name.localeCompare(a.name))[0]
        if (latest) this.resume = { name: 'storyboard', query: { episode: latest.name }, labels: [this.episodeTitle(latest.name), this.$t('分镜')] }
      } catch { /* A project without an available storyboard has no suggested position. */ }
    },
    episodeTitle(name) {
      if (name === 'opening') return this.$t('片头')
      if (name === 'ending') return this.$t('片尾')
      return name.replace(/^\d{3}-/, '')
    },
    async playAt(position) {
      if (!this.playlist[position]) return
      this.videoError = false
      this.position = position
      await this.$nextTick()
      try { await this.$refs.player.play() } catch { /* Native controls allow manual playback. */ }
    },
    async loadCount(route) {
      try {
        const items = await requestAsset(route)
        if (route === 'scripts') {
          this.playlist = items.filter(item => item.videos.length).map(item => ({
            episode: item.name,
            file: item.videos.find(file => /^index\.mp4$/i.test(file))
              || item.videos.find(file => /^index\./i.test(file)) || item.videos[0],
          }))
        }
        this.counts[route] = route === 'scripts'
          ? items.filter(item => /^\d{3}-/.test(item.name)).length
          : items.length
      } catch {
        this.counts[route] = null
      }
    },
  },
}
</script>

<template>
  <section class="content">
    <h1>{{ $t('项目总览') }}</h1>
    <RouterLink v-if="resume" class="resume-work" :to="{ name: resume.name, query: resume.query }">
      <strong>{{ $t('继续制作') }}</strong><span>{{ resume.labels.join(' / ') }}</span><ChevronRight :size="16" />
    </RouterLink>
    <div class="overview-grid">
      <RouterLink v-for="metric in metrics" :key="metric.route" class="overview-card" :to="{ name: metric.route }">
        <span class="overview-label"><component :is="metric.icon" :size="18" />{{ $t(metric.label) }}</span>
        <strong>{{ counts[metric.route] === null ? $t('读取失败') : counts[metric.route] ?? '…' }}</strong>
        <ChevronRight class="overview-arrow" :size="16" />
      </RouterLink>
    </div>
    <section class="screening">
      <h2>{{ $t('成片连播') }}</h2>
      <template v-if="current">
        <video ref="player" :key="current.episode" controls playsinline preload="metadata"
          :aria-label="episodeTitle(current.episode)" :src="'/api/scripts?video=' + encodeURIComponent(current.episode + '/' + current.file)"
          @error="videoError = true" @ended="playAt(position + 1)" />
        <p v-if="videoError" role="alert">{{ $t('无法播放此视频') }}</p>
        <div class="screening-list">
          <button v-for="(item, index) in playlist" :key="item.episode" :aria-pressed="position === index" @click="playAt(index)">
            {{ episodeTitle(item.episode) }}
          </button>
        </div>
      </template>
      <p v-else>{{ $t(counts.scripts === undefined ? '加载中' : counts.scripts === null ? '读取失败' : '暂无成片') }}</p>
    </section>
  </section>
</template>

<style scoped>
.resume-work, .screening { background: white; border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-top: 20px; }
.resume-work { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; color: inherit; text-decoration: none; }
.resume-work span { color: var(--muted); }
.resume-work svg { margin-left: auto; color: var(--accent); }
.screening h2 { font-size: 18px; margin: 0 0 14px; }
.screening video { display: block; width: 100%; max-height: 55vh; background: #12151b; }
.screening-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.screening-list button { border: 1px solid var(--line); border-radius: 8px; background: white; padding: 6px 12px; }
.screening-list button[aria-pressed=true] { color: var(--accent); background: var(--accent-bg); }
</style>
