<script>
import AssetDeleteButton from '@/components/AssetDeleteButton.vue'
import AssetTagInput from '@/components/AssetTagInput.vue'
import { requestAsset } from '@/service/assets.js'
import { ElInput, ElOption, ElSelect, ElUpload } from 'element-plus'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/upload/style/css'
import { AudioLines, Plus, Search, Upload, X } from 'lucide-vue-next'

const categories = { music: '音乐', effect: '音效', dialogue: '台词' }

export default {
  components: { AssetDeleteButton, AssetTagInput, AudioLines, ElInput, ElOption, ElSelect, ElUpload, Plus, Search, Upload, X },
  data() {
    return { categories, assets: [], query: '', filter: '', tagFilters: [], overview: null, create: null, active: null, busy: false, error: '', durations: {} }
  },
  computed: {
    typedAssets() {
      return this.assets.filter(asset => !this.filter || asset.categories.includes(this.filter))
    },
    availableTags() {
      return [...new Set(this.typedAssets.flatMap(asset => asset.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },
    visibleAssets() {
      const query = this.query.trim().toLowerCase()
      return this.typedAssets.filter(asset => this.tagFilters.every(tag => asset.tags?.includes(tag))
        && [asset.name, ...asset.groupPath, ...(asset.tags || []), ...asset.categories.flatMap(category => [categories[category], this.$t(categories[category])])]
          .some(value => value?.toLowerCase().includes(query)))
    },
  },
  watch: {
    availableTags(tags) {
      this.tagFilters = this.tagFilters.filter(tag => tags.includes(tag))
    },
  },
  beforeRouteLeave() {
    if (this.busy) return false
  },
  mounted() {
    this.refresh()
    import.meta.hot?.on('workbench:audio:changed', this.refresh)
  },
  beforeUnmount() {
    import.meta.hot?.off('workbench:audio:changed', this.refresh)
  },
  methods: {
    toggleTag(tag) {
      this.tagFilters = this.tagFilters.includes(tag)
        ? this.tagFilters.filter(value => value !== tag)
        : [...this.tagFilters, tag]
    },
    async submitOverview(method, data) {
      if (this.busy || !this.active) return
      this.busy = true
      this.error = ''
      try {
        await requestAsset('audio', this.active.id, method, data)
        this.$refs.dialog.close()
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    async refresh() {
      try {
        this.assets = await requestAsset('audio')
        const active = this.active
        if (!active || this.busy || !this.assets.some(item => item.id === active.id)) return
        const detail = await requestAsset('audio', active.id)
        if (this.active === active && !this.busy) this.active = detail
      } catch (cause) {
        this.error = cause.message
      }
    },
    showCreate() {
      this.error = ''
      this.create = { name: '' }
      this.$refs.create.showModal()
    },
    async createAudio() {
      this.busy = true
      this.error = ''
      try {
        await requestAsset('audio', null, 'POST', { name: this.create.name.trim() })
        this.$refs.create.close()
        this.query = ''
        this.filter = ''
        this.tagFilters = []
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    loadOverview() {
      this.overview = {
        name: this.active.name,
        type: this.active.type,
        tags: [...this.active.tags],
        note: this.active.note,
      }
    },
    async open(item) {
      this.error = ''
      this.busy = true
      try {
        this.active = await requestAsset('audio', item.id)
        this.loadOverview()
        this.$refs.dialog.showModal()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    close() {
      this.active = null
      this.error = ''
    },
    async uploadTrack({ raw: file }) {
      this.$refs.audioUpload?.clearFiles()
      if (!file || this.busy || !this.active) return
      const track = this.active.cover || this.active.images[0]
      if (file.size > 30 * 1024 * 1024) {
        this.error = this.$t('请选择 30 MB 以内的音频')
        return
      }
      this.busy = true
      this.error = ''
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = () => reject(new Error(this.$t('读取音频失败')))
          reader.readAsDataURL(file)
        })
        this.active = await requestAsset('audio', this.active.id, 'PATCH', {
          track: {
            id: track?.id,
            label: file.name,
            filename: file.name,
            category: this.active.type || track?.category || 'music',
            status: track?.status || 'reference',
            prompt: '',
            source: track?.source,
            usage: track?.usage,
            loop: track?.loop,
            base64,
          },
        })
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    recordDuration(track, event) {
      const duration = event.target.duration
      if (!Number.isFinite(duration)) return
      const seconds = Math.round(duration)
      this.durations[track.url] = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
    },
  },
}
</script>

<template>
  <section class="content">
    <div class="heading">
      <div><h1>{{ $t('音频资产') }}</h1><p>{{ $t('{count} 个音频资产', { count: assets.length }) }}</p></div>
      <button class="primary" :disabled="busy" @click="showCreate"><Plus :size="18" /> {{ $t('新建音频') }}</button>
    </div>
    <div class="tools">
      <label class="search"><Search :size="17" /><input v-model="query" :placeholder="$t('搜索名称或标签')" :aria-label="$t('搜索名称或标签')"></label>
      <div class="filter-list" role="group" :aria-label="$t('音频类型')">
        <span class="filter-label">{{ $t('类型') }}</span>
        <button class="tag" :class="{ chosen: !filter }" :aria-pressed="!filter" @click="filter = ''">{{ $t('全部') }}</button>
        <button v-for="(label, key) in categories" :key="key" class="tag" :class="{ chosen: filter === key }" :aria-pressed="filter === key" @click="filter = key">{{ $t(label) }}</button>
      </div>
      <div class="filter-list" role="group" :aria-label="$t('音频标签')">
        <span class="filter-label">{{ $t('标签') }}</span>
        <button class="tag" :class="{ chosen: !tagFilters.length }" :aria-pressed="!tagFilters.length" @click="tagFilters = []">{{ $t('全部') }}</button>
        <button v-for="tag in availableTags" :key="tag" class="tag" :class="{ chosen: tagFilters.includes(tag) }"
          :aria-pressed="tagFilters.includes(tag)" @click="toggleTag(tag)">{{ tag }}</button>
      </div>
    </div>
    <p v-if="error && !active && !create" class="error" role="alert">{{ error }}</p>
    <p v-if="!visibleAssets.length" class="empty">{{ assets.length ? $t('没有符合筛选条件的音频。') : $t('暂无音频素材。') }}</p>
    <div class="grid">
      <article v-for="item in visibleAssets" :key="item.id" class="card audio-card" @click="!busy && open(item)">
        <button class="character-name" :disabled="busy"><AudioLines :size="17" />{{ item.name }}</button>
        <p v-if="item.groupPath.length" class="asset-group-path">{{ item.groupPath.join(' / ') }}</p>
        <div class="card-tags"><span v-for="category in item.categories" :key="category" class="tag compact">{{ $t(categories[category]) }}</span><span v-for="tag in item.tags" :key="tag" class="tag compact">{{ tag }}</span></div>
        <audio v-if="item.cover?.url" :src="item.cover.url" controls preload="none" :aria-label="item.cover.label" @click.stop></audio>
      </article>
    </div>

    <dialog ref="create" class="dialog small-dialog" @close="create = null" @cancel.prevent="!busy && $refs.create.close()">
      <form class="dialog-form" v-if="create" @submit.prevent="createAudio">
        <header class="dialog-head">
          <h2>{{ $t('新建音频') }}</h2>
          <button type="button" class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.create.close()"><X :size="20" /></button>
        </header>
        <div class="dialog-body">
          <div class="audio-field">
            <label for="create-audio-name">{{ $t('名称') }}</label>
            <ElInput id="create-audio-name" v-model="create.name" required autofocus :disabled="busy" />
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
        <footer class="dialog-footer">
          <button type="button" class="secondary" :disabled="busy" @click="$refs.create.close()">{{ $t('取消') }}</button>
          <button type="submit" class="primary" :disabled="busy">{{ $t('创建音频') }}</button>
        </footer>
      </form>
    </dialog>

    <dialog ref="dialog" class="dialog audio-detail-dialog" @close="close"
      @cancel.prevent="!busy && !$event.currentTarget.querySelector('.asset-delete-message') && $refs.dialog.close()">
      <header class="dialog-head">
        <h2>{{ active?.name }}</h2>
        <button class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.dialog.close()"><X :size="20" /></button>
      </header>
      <div class="dialog-body">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="active">
          <form id="audio-overview-form" class="edit-form" @submit.prevent="submitOverview('PATCH', overview)">
            <div class="audio-field">
              <label for="audio-name">{{ $t('名称') }}</label>
              <ElInput id="audio-name" v-model="overview.name" required :disabled="busy" />
            </div>
            <div class="audio-field">
              <label for="audio-type">{{ $t('类型') }}</label>
              <ElSelect id="audio-type" v-model="overview.type" :placeholder="$t('未设置')" :teleported="false" :disabled="busy">
                <ElOption :label="$t('未设置')" value="" />
                <ElOption v-for="(label, key) in categories" :key="key" :label="$t(label)" :value="key" />
              </ElSelect>
            </div>
            <div class="audio-field">
              <label for="audio-tags">{{ $t('标签') }}</label>
              <AssetTagInput id="audio-tags" v-model="overview.tags" :disabled="busy" />
            </div>
            <div class="audio-field">
              <label for="audio-note">{{ $t('备注') }}</label>
              <ElInput id="audio-note" v-model="overview.note" type="textarea" :rows="3" :disabled="busy" />
            </div>
            <div class="audio-field">
              <span>{{ $t('音频文件') }}</span>
              <ElUpload ref="audioUpload" accept=".mp3,.wav,.ogg,.m4a,.flac,.aac" :auto-upload="false"
                :show-file-list="false" :disabled="busy" :on-change="uploadTrack">
                <button type="button" class="secondary" :disabled="busy">
                  <Upload :size="15" /> {{ active.images.length ? $t('替换音频') : $t('上传音频') }}
                </button>
              </ElUpload>
              <article v-for="track in active.images" :key="track.id" class="audio-track">
                <strong>{{ track.label }}</strong>
                <p class="asset-group-path">{{ $t(categories[track.category]) }}<template v-if="durations[track.url]"> · {{ durations[track.url] }}</template><template v-if="track.loop"> · {{ $t('可循环') }}</template></p>
                <audio v-if="track.url" controls preload="metadata" :src="track.url" @loadedmetadata="recordDuration(track, $event)"></audio>
                <p v-else class="empty">{{ $t('找不到音频文件 {file}', { file: track.file }) }}</p>
                <p v-if="track.usage">{{ $t('备注') }}　{{ track.usage }}</p>
                <p v-if="track.source">{{ $t('来源与授权') }}　{{ track.source }}</p>
              </article>
            </div>
            <details v-if="active.history.length" class="audio-track">
              <summary>{{ $t('历史版本') }}</summary>
              <section v-for="version in active.history" :key="version.version">
                <p>{{ version.version }} {{ version.note }}</p>
                <audio v-for="track in version.images.filter(item => item.url)" :key="track.url" :src="track.url" :aria-label="track.label" controls preload="none"></audio>
              </section>
            </details>

          </form>
        </template>
      </div>
      <footer class="dialog-footer overview-actions" v-if="active">
        <AssetDeleteButton :asset-name="active.name" :busy="busy" @confirm="submitOverview('DELETE', {})" />
        <button type="button" class="secondary" :disabled="busy" @click="$refs.dialog.close()">{{ $t('取消') }}</button>
        <button form="audio-overview-form" type="submit" class="primary overview-save-button" :disabled="busy">{{ $t('保存') }}</button>
      </footer>
    </dialog>
  </section>
</template>

<style scoped>
.audio-card {
  cursor: pointer;
}

.audio-field {
  display: grid;
  gap: 6px;
  color: #4b5267;
  font-size: 13px;
}

.small-dialog .audio-field {
  margin-bottom: 12px;
}

.dialog {
  --form-focus-ring: rgb(91 92 245 / 16%);
  --el-border-radius-base: 7px;
}

.audio-field :deep(:is(.el-input__wrapper, .el-select__wrapper, .el-input-tag, .el-textarea__inner)) {
  min-height: 34px;
  transition: box-shadow 160ms ease;
}

.audio-field :deep(:is(.el-input__wrapper, .el-select__wrapper, .el-input-tag, .el-textarea__inner):focus-within),
.audio-field :deep(:is(.el-input__wrapper, .el-select__wrapper, .el-input-tag, .el-textarea__inner):focus) {
  box-shadow: inset 0 0 0 1px var(--focus-border), 0 0 0 3px var(--form-focus-ring);
}

.filter-label {
  align-self: center;
  margin-right: 6px;
  color: var(--muted, #64748b);
  font-size: 13px;
}
</style>
