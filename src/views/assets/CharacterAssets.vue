<script>
import AssetDeleteButton from '@/components/AssetDeleteButton.vue'
import { ElCheckbox, ElDropdown, ElDropdownItem, ElDropdownMenu, ElSwitch } from 'element-plus'
import AssetHistory from '@/components/AssetHistory.vue'
import AssetStoryEditor from '@/components/AssetStoryEditor.vue'
import AssetTagInput from '@/components/AssetTagInput.vue'
import ProjectMarkdown from '@/components/ProjectMarkdown.vue'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/dropdown-item/style/css'
import 'element-plus/es/components/dropdown-menu/style/css'
import 'element-plus/es/components/switch/style/css'
import { AudioLines, Check, ChevronDown, Image, Layers3, ListChecks, Pencil, Play, Square, Plus, RefreshCw, Search, Star, Upload, X } from 'lucide-vue-next'
import { requestAsset } from '@/service/assets.js'
import { jimengSyncUrl } from '@/service/jimeng.js'

const mediaTypes = [
  { key: 'image2d', label: '2D 图', icon: 'Image', accept: '.png,.jpg,.jpeg,.webp,.avif' },
  { key: 'image3d', label: '3D 图', icon: 'Layers3', accept: '.png,.jpg,.jpeg,.webp,.avif' },
  // 3D 模型入口暂缓，启用时恢复此项和 Box 图标注册。
  // { key: 'model3d', label: '3D 模型', icon: 'Box', accept: '.glb' },
  { key: 'voice', label: '音色', icon: 'AudioLines', accept: '.mp3,.wav,.ogg,.m4a,.flac,.aac' },
]
const tabs = [
  { key: 'overview', label: '概览' }, ...mediaTypes,
  { key: 'portraits', label: '特写' }, { key: 'skins', label: '皮肤' },
  { key: 'story', label: '设定' }, { key: 'history', label: '历史版本' },
]

export default {
  name: 'CharacterAssets',
  components: { AssetDeleteButton, AssetHistory, AssetStoryEditor, AssetTagInput, ProjectMarkdown, ElCheckbox, ElDropdown, ElDropdownItem, ElDropdownMenu, ElSwitch, AudioLines, Check, ChevronDown, Image, Layers3, ListChecks, Pencil, Play, Square, Plus, RefreshCw, Search, Star, Upload, X },
  data() {
    return {
      voicePlayer: null, playingVoice: null,
      mediaTypes, tabs, characters: [], query: '', filters: [], missingVoiceOnly: false, coverPreview: '', cardPreviews: {},
      selecting: false, selectedIds: new Set(),
      active: null, activeTab: 'overview', galleryFile: '', creating: false, busy: false,
      form: null, overviewDraft: {}, storyDraft: null, promptDraft: null, error: '', pageError: '', ready: false, refreshRevision: 0, openRevision: 0,
    }
  },
  computed: {
    codexSyncUrl() {
      return jimengSyncUrl('characters', [this.active], '请按咔嚓的 sync-jimeng-assets 技能，将这个角色同步到即梦网页主体库。')
    },
    tags() {
      return [...new Set(this.characters.flatMap(character => character.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },
    canSwitchCovers() {
      return this.visibleCharacters.some(character => this.canSwitchCover(character))
    },
    visibleCharacters() {
      const query = this.query.trim().toLowerCase()
      return this.characters.filter(character => (!this.missingVoiceOnly || !character.media.voice)
        && this.filters.every(tag => character.tags.includes(tag))
        && [character.name, ...character.tags].some(value => value.toLowerCase().includes(query)))
    },
    selectedCharacters() {
      return this.characters.filter(character => this.selectedIds.has(character.id))
    },
    allVisibleSelected() {
      return this.visibleCharacters.length > 0 && this.visibleCharacters.every(character => this.selectedIds.has(character.id))
    },
    galleryImages() {
      return (this.activeTab === 'skins' ? this.active?.skins : this.active?.portraits) ?? []
    },
    currentGalleryImage() {
      return this.galleryImages.find(image => image.file === this.galleryFile) || this.galleryImages[0]
    },
    overviewTags() {
      return this.overviewDraft.tags ?? this.active?.tags ?? []
    },
    mediaSlot() {
      return this.mediaTypes.find(slot => slot.key === this.activeTab)
    },
    currentPrompt() {
      return this.active?.prompts[this.mediaSlot?.key] || ''
    },
    activeImage() {
      const slot = this.activeTab
      return ['image2d', 'image3d'].includes(slot) ? this.active.media[slot] : null
    },
  },
  beforeRouteLeave() {
    if (this.busy) return false
  },
  deactivated() {
    this.stopVoice()
    this.toggleSelection(false)
    this.openRevision++
    this.$refs.create.close()
    this.$refs.detail.close()
  },
  mounted() {
    this.refresh()
    import.meta.hot?.on('workbench:characters:changed', this.refreshAssets)
  },
  beforeUnmount() {
    this.stopVoice()
    import.meta.hot?.off('workbench:characters:changed', this.refreshAssets)
  },
  methods: {
    stopVoice() {
      this.voicePlayer?.pause()
      this.voicePlayer = null
      this.playingVoice = null
    },
    async toggleVoice(character) {
      const alreadyPlaying = this.playingVoice === character.id
      this.stopVoice()
      if (alreadyPlaying) return
      const player = new Audio(character.media.voice)
      this.voicePlayer = player
      this.playingVoice = character.id
      player.onended = () => {
        if (this.voicePlayer === player) this.stopVoice()
      }
      try {
        await player.play()
      } catch {
        if (this.voicePlayer !== player) return
        this.stopVoice()
        this.pageError = this.$t('无法播放默认音色')
      }
    },
    async refreshAssets() {
      await this.refresh()
      const active = this.active
      if (!active || this.busy || this.storyDraft !== null || this.promptDraft !== null || !this.characters.some(item => item.id === active.id)) return
      try {
        const detail = await requestAsset('characters', active.id)
        if (this.active === active && !this.busy && this.storyDraft === null && this.promptDraft === null) this.active = detail
      } catch (cause) {
        if (this.active === active) this.error = cause.message
      }
    },
    async refresh() {
      const revision = ++this.refreshRevision
      try {
        const characters = await requestAsset('characters')
        if (revision !== this.refreshRevision) return
        this.characters = characters
        this.selectedIds = new Set(characters.filter(character => this.selectedIds.has(character.id)).map(character => character.id))
        this.filters = this.filters.filter(tag => this.tags.includes(tag))
        this.ready = true
        this.pageError = ''
      } catch (error) {
        if (revision === this.refreshRevision) this.pageError = error.message
      }
    },
    toggleSelection(selecting) {
      this.selecting = selecting
      this.openRevision++
      if (!selecting) this.selectedIds.clear()
    },
    setSelected(id, selected) {
      if (selected) this.selectedIds.add(id)
      else this.selectedIds.delete(id)
    },
    toggleVisibleSelection() {
      const selected = !this.allVisibleSelected
      for (const character of this.visibleCharacters) this.setSelected(character.id, selected)
    },
    canSetBatchCover(slot) {
      return this.selectedCharacters.some(character => character.media[slot] && character.main !== slot)
    },
    handleBatchAction(command) {
      if (this.busy || !this.selectedCharacters.length) return
      if (command !== 'syncJimeng') return this.setBatchCover(command)

      const url = jimengSyncUrl(
        'characters',
        this.selectedCharacters,
        '请按咔嚓的 sync-jimeng-assets 技能，将以下角色批量新增到即梦网页主体库，跳过已有主体。',
      )
      window.location.assign(url)
    },
    async setBatchCover(slot) {
      if (this.busy || !['image2d', 'image3d'].includes(slot)) return
      const targets = this.selectedCharacters.filter(character => character.media[slot] && character.main !== slot)
      if (!targets.length) return
      const failures = []
      this.busy = true
      this.pageError = ''
      try {
        for (const character of targets) {
          try {
            await requestAsset('characters', character.id, 'PATCH', { mainImage: slot })
          } catch (error) {
            failures.push(`${character.name} · ${error.message}`)
          }
        }
        await this.refresh()
        if (failures.length) {
          this.pageError = [this.pageError, ...failures].filter(Boolean).join(' / ')
        }
      } finally {
        this.busy = false
      }
    },
    toggleTag(tag) {
      this.filters = this.filters.includes(tag) ? this.filters.filter(value => value !== tag) : [...this.filters, tag]
    },
    setCoverPreview(preview) {
      this.coverPreview = preview
      this.cardPreviews = {}
    },
    canSwitchCover(character) {
      return Boolean(character.media.image2d && character.media.image3d)
    },
    cardImage(character) {
      const preview = this.cardPreviews[character.id] || this.coverPreview
      return character.media[preview] ? preview : character.main
    },
    async open(character) {
      this.stopVoice()
      if (this.selecting) {
        this.setSelected(character.id, !this.selectedIds.has(character.id))
        return
      }
      const revision = ++this.openRevision
      try {
        const detail = await requestAsset('characters', character.id)
        if (revision !== this.openRevision) return
        this.overviewDraft = {}
        this.selectTab('overview')
        this.active = detail
        if (!this.$refs.detail.open) this.$refs.detail.showModal()
      } catch (error) {
        if (revision === this.openRevision) this.pageError = error.message
      }
    },
    showCreate() {
      this.error = ''
      this.form = { name: '' }
      this.creating = true
      this.$refs.create.showModal()
    },
    closeDetail() {
      this.openRevision++
      this.active = null
      this.storyDraft = null
      this.overviewDraft = {}
      this.error = ''
    },
    selectTab(tab) {
      this.activeTab = tab
      if (this.$refs.detailBody) this.$refs.detailBody.scrollTop = 0
      this.storyDraft = null
      this.galleryFile = ''
      this.error = ''
      this.promptDraft = null
    },
    async deleteAsset() {
      if (this.busy || !this.active) return
      this.busy = true
      this.error = ''
      try {
        await requestAsset('characters', this.active.id, 'DELETE', {})
        this.$refs.detail.close()
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    async saveOverview() {
      if (Object.keys(this.overviewDraft).length && await this.save(this.overviewDraft)) this.overviewDraft = {}
    },
    async saveStory() {
      if (this.storyDraft !== null && await this.save({ story: this.storyDraft })) this.storyDraft = null
    },
    async save(patch, create = false) {
      this.busy = true
      this.error = ''
      try {
        this.active = await requestAsset('characters', create ? null : this.active.id, create ? 'POST' : 'PATCH', patch)
        if (create) {
          this.$refs.create.close()
          this.selectTab('overview')
          this.$refs.detail.showModal()
        }
        await this.refresh()
        return true
      } catch (error) {
        this.error = error.message
        return false
      } finally {
        this.busy = false
      }
    },
    async savePrompt() {
      const prompts = { ...this.active.prompts, [this.mediaSlot.key]: this.promptDraft }
      if (await this.save({ prompts })) this.promptDraft = null
    },
    async upload(event) {
      const input = event.target
      const file = input.files[0]
      if (!file) return
      const slot = this.mediaSlot.key
      const prompt = this.promptDraft ?? ''
      this.busy = true
      try {
        if (file.size > 60 * 1024 * 1024) throw new Error(this.$t('素材超过 60 MB'))
        const reader = new FileReader()
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = () => reject(new Error(this.$t('读取素材失败')))
          reader.readAsDataURL(file)
        })
        if (await this.save({ upload: { slot, filename: file.name, base64, prompt } })) this.promptDraft = null
      } catch (error) {
        this.error = error.message
      } finally {
        this.busy = false
        input.value = ''
      }
    },
  },
}
</script>

<template>
  <div>
    <section class="content">
      <div class="heading">
        <div><h1>{{ $t('角色资产') }}</h1><p>{{ $t('{count} 个角色', { count: characters.length }) }}</p></div>
        <button class="primary" @click="showCreate"><Plus :size="18" /> {{ $t('新建角色') }}</button>
      </div>
      <div class="tools">
        <div class="character-toolbar">
          <label class="search"><Search :size="17" /><input v-model="query" :placeholder="$t('搜索名称或标签')" :aria-label="$t('搜索名称或标签')"></label>
          <div class="character-toolbar-actions">
            <label class="voice-filter">
              <span>{{ $t('音色缺失') }}</span>
              <ElSwitch v-model="missingVoiceOnly" size="small" :aria-label="$t('音色缺失')" />
            </label>
            <div v-if="canSwitchCovers" class="cover-preview-control" role="group" :aria-label="$t('切换全部角色封面图')">
              <span>{{ $t('封面图') }}</span>
              <div class="cover-preview-options">
                <button type="button" :aria-pressed="coverPreview === 'image2d'" @click="setCoverPreview('image2d')">2D</button>
                <button type="button" :aria-pressed="coverPreview === 'image3d'" @click="setCoverPreview('image3d')">3D</button>
              </div>
            </div>
          </div>
          <div class="character-selection-actions">
            <template v-if="selecting">
              <span role="status">{{ $t('已选 {count} 个', { count: selectedIds.size }) }}</span>
              <button type="button" class="secondary" :disabled="!visibleCharacters.length" @click="toggleVisibleSelection">
                {{ $t(allVisibleSelected ? '取消全选' : '全选') }}
              </button>
              <button type="button" class="secondary" :disabled="!selectedIds.size" @click="selectedIds.clear()">{{ $t('清空') }}</button>
            </template>
            <button type="button" class="secondary" :aria-pressed="selecting" :disabled="busy" @click="toggleSelection(!selecting)">
              <ListChecks :size="16" aria-hidden="true" />
              {{ $t(selecting ? '退出' : '批量选择') }}
            </button>
            <ElDropdown v-if="selecting" trigger="click" :disabled="busy || !selectedIds.size" @command="handleBatchAction">
              <button type="button" class="primary" :disabled="busy || !selectedIds.size">
                {{ $t('批量操作') }} <ChevronDown :size="16" aria-hidden="true" />
              </button>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem command="image2d" :disabled="!canSetBatchCover('image2d')">{{ $t('设为 2D 主图') }}</ElDropdownItem>
                  <ElDropdownItem command="image3d" :disabled="!canSetBatchCover('image3d')">{{ $t('设为 3D 主图') }}</ElDropdownItem>
                  <ElDropdownItem command="syncJimeng" divided>{{ $t('用 Codex 同步到即梦') }}</ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
          </div>
        </div>
        <div class="filter-list" :aria-label="$t('按标签筛选')">
          <button class="tag" :class="{ chosen: !filters.length }" @click="filters = []">{{ $t('全部') }}</button>
          <button v-for="tag in tags" :key="tag" class="tag" :class="{ chosen: filters.includes(tag) }" :aria-pressed="filters.includes(tag)" @click="toggleTag(tag)">{{ tag }}</button>
        </div>
      </div>
      <p v-if="pageError" class="error" role="alert">{{ pageError }}</p>
      <p v-if="ready && !visibleCharacters.length" class="empty">{{ $t('没有匹配的角色') }}</p>
      <div class="grid">
        <article v-for="character in visibleCharacters" :key="character.id" class="card" :class="{ 'character-card-selected': selectedIds.has(character.id) }">
          <div class="card-preview">
            <ElCheckbox v-if="selecting" class="character-selection-checkbox"
              :model-value="selectedIds.has(character.id)" :aria-label="character.name"
              @change="setSelected(character.id, $event)" />
            <button class="cover" :aria-label="selecting ? character.name : $t('查看 {name}', { name: character.name })"
              :aria-pressed="selecting ? selectedIds.has(character.id) : undefined" @click="open(character)">
              <img v-if="character.main" :src="character.media[cardImage(character)]" loading="lazy" :alt="character.name">
              <span v-else class="character-cover-empty" aria-hidden="true"></span>
            </button>
            <div v-if="canSwitchCover(character) || character.media.voice" class="preview-toggle" role="group" :aria-label="$t('{name} 预览', { name: character.name })">
              <template v-if="canSwitchCover(character)">
                <button :aria-pressed="cardImage(character) === 'image2d'" @click="cardPreviews[character.id] = 'image2d'">2D</button>
                <button :aria-pressed="cardImage(character) === 'image3d'" @click="cardPreviews[character.id] = 'image3d'">3D</button>
              </template>
              <button v-if="character.media.voice" type="button"
                :title="$t('试听默认音色')" :aria-label="$t('试听默认音色')" :aria-pressed="playingVoice === character.id"
                @click="toggleVoice(character)">
                <component :is="playingVoice === character.id ? 'Square' : 'Play'" :size="12" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class="card-info">
            <button class="character-name" @click="open(character)">{{ character.name }}</button>
            <div class="card-tags"><button v-for="tag in character.tags" :key="tag" class="tag compact" @click="toggleTag(tag)">{{ tag }}</button></div>
            <div class="indicators">
              <span v-for="slot in mediaTypes" :key="slot.key" class="indicator"
                :title="character.media[slot.key] ? $t('已配置') : $t('待补充')">
                <span class="indicator-icon" aria-hidden="true">
                  <component :is="slot.icon" :size="14" />
                  <span v-if="character.media[slot.key]" class="status-check"><Check :size="6" :stroke-width="3" /></span>
                </span>
                <span>{{ $t(slot.label) }}</span>
                <span class="visually-hidden">{{ character.media[slot.key] ? $t('已配置') : $t('待补充') }}</span>
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <dialog ref="create" class="dialog small-dialog" @close="creating = false" @cancel.prevent="!busy && $refs.create.close()">
      <form class="dialog-form" v-if="creating" @submit.prevent="save({ name: form.name }, true)">
        <header class="dialog-head"><h2>{{ $t('新建角色') }}</h2><button type="button" class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.create.close()"><X :size="20" /></button></header>
        <div class="dialog-body"><label class="field">{{ $t('角色名') }}<input v-model="form.name" required autofocus></label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
        <footer class="dialog-footer">
          <button type="button" class="secondary" :disabled="busy" @click="$refs.create.close()">{{ $t('取消') }}</button>
          <button type="submit" class="primary" :disabled="busy">{{ $t('创建角色') }}</button>
        </footer>
      </form>
    </dialog>

    <dialog ref="detail" class="dialog asset-detail-dialog" @close="closeDetail" @cancel.prevent="!busy && !$event.currentTarget.querySelector('.asset-delete-message') && $refs.detail.close()">
      <template v-if="active">
        <header class="dialog-head">
          <div><h2>{{ active.name }}</h2><div class="card-tags"><span v-for="tag in active.tags" :key="tag" class="tag compact">{{ tag }}</span></div></div>
          <div class="dialog-actions">
            <button class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.detail.close()"><X :size="20" /></button>
          </div>
        </header>
        <div class="tabs">
          <button v-for="tab in tabs" :key="tab.key" :disabled="busy" :class="{ current: activeTab === tab.key }" @click="selectTab(tab.key)">{{ $t(tab.label) }}</button>
        </div>
        <div ref="detailBody" class="dialog-body">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <form v-if="activeTab === 'overview'" id="character-overview-form" class="edit-form" @submit.prevent="saveOverview">
            <label class="field">{{ $t('名称') }}
              <input :value="overviewDraft.name ?? active.name" required :disabled="busy"
                @input="overviewDraft.name = $event.target.value">
            </label>
            <div class="asset-tag-field">
              <label class="field" for="character-tag-input">{{ $t('标签') }}</label>
              <AssetTagInput id="character-tag-input" :model-value="overviewTags" :disabled="busy"
                @update:model-value="overviewDraft.tags = $event" />
            </div>
            <label class="field">{{ $t('备注') }}
              <textarea :value="overviewDraft.note ?? active.note" rows="8" :placeholder="$t('写点笔记…')" :disabled="busy"
                @input="overviewDraft.note = $event.target.value"></textarea>
            </label>
          </form>
          <template v-else-if="activeTab === 'portraits' || activeTab === 'skins'">
            <template v-if="currentGalleryImage">
              <div class="scene-thumbnails contain-thumbnails" :aria-label="activeTab === 'skins' ? $t('皮肤图片') : $t('角色特写图片')">
                <button v-for="image in galleryImages" :key="image.file" type="button"
                  :aria-pressed="image.file === currentGalleryImage.file" @click="galleryFile = image.file">
                  <img :src="image.url" alt="" loading="lazy"><span>{{ image.name }}</span>
                </button>
              </div>
              <a :href="currentGalleryImage.url" target="_blank" rel="noopener noreferrer">
                <img class="detail-image" :src="currentGalleryImage.url" :alt="currentGalleryImage.name">
              </a>
              <div class="scene-image-info"><strong>{{ currentGalleryImage.name }}</strong></div>
              <section v-if="currentGalleryImage.prompt" class="prompt">
                <strong>{{ $t('生成词') }}</strong>
                <pre>{{ currentGalleryImage.prompt }}</pre>
              </section>
            </template>
            <div v-else class="detail-placeholder">
              <Image :size="25" />
              {{ activeTab === 'portraits' ? $t('暂无特写') : $t('暂无皮肤') }}
            </div>
          </template>
          <AssetStoryEditor v-else-if="activeTab === 'story'" v-model:draft="storyDraft" :busy="busy"
            @edit="storyDraft = active.story; error = ''" @cancel="storyDraft = null; error = ''" @save="saveStory">
            <ProjectMarkdown v-if="active.story" :source="active.story" />
            <p v-else class="empty">{{ $t('还没有角色设定。') }}</p>
          </AssetStoryEditor>
          <AssetHistory v-else-if="activeTab === 'history'" :versions="active.history" group="character-history">
            <template #description="{ version }">
              <small v-if="version.changes.length">{{ version.changes.map(key => mediaTypes.find(slot => slot.key === key)?.label || ({ story: '设定', prompts: '生成词' }[key])).filter(Boolean).map(label => $t(label)).join(' · ') }}</small>
            </template>
            <template #default="{ version }">
              <template v-for="file in version.files" :key="file.url">
                <a v-if="file.type.startsWith('image/')" :href="file.url" target="_blank" rel="noopener noreferrer"><img :src="file.url" :alt="file.name" loading="lazy"></a>
                <audio v-else-if="file.type.startsWith('audio/')" :src="file.url" controls></audio>
                <a v-else :href="file.url" download>{{ file.name }}</a>
              </template>
              <ProjectMarkdown v-if="version.story" :source="version.story" />
              <template v-for="(prompt, key) in version.prompts" :key="key">
                <div v-if="prompt"><strong>{{ $t('{label}生成词', { label: $t(mediaTypes.find(slot => slot.key === key)?.label || '主图') }) }}</strong><pre>{{ prompt }}</pre></div>
              </template>
            </template>
          </AssetHistory>
          <template v-else>
            <img v-if="activeImage" class="detail-image" :src="activeImage" :alt="active.name">
            <audio v-else-if="activeTab === 'voice' && active.media.voice" :src="active.media.voice" controls></audio>
            <a v-else-if="activeTab === 'model3d' && active.media.model3d" class="secondary" :href="active.media.model3d" download="model.glb">{{ $t('下载 GLB 模型') }}</a>
            <div v-else class="detail-placeholder"><component :is="mediaSlot?.icon || 'Image'" :size="28" />{{ $t('待补{label}', { label: $t(mediaSlot?.label || '主图') }) }}</div>
            <div v-if="mediaSlot" class="media-actions">
              <label class="secondary upload"><component :is="active.media[mediaSlot.key] ? 'RefreshCw' : 'Upload'" :size="15" aria-hidden="true" />{{ $t(active.media[mediaSlot.key] ? '替换{label}' : '上传{label}', { label: $t(mediaSlot.label) }) }}<input type="file" :accept="mediaSlot.accept" :disabled="busy" @change="upload"></label>
              <button v-if="activeImage" class="secondary" :disabled="busy || active.main === activeTab" @click="save({ mainImage: activeTab })">
                <component :is="active.main === activeTab ? 'Check' : 'Star'" :size="15" aria-hidden="true" />
                {{ active.main === activeTab ? $t('当前主图') : $t('设为主图') }}
              </button>
            </div>
            <div v-if="activeTab === 'voice' && active.extraVoice.length" class="extra-voice">
              <div v-for="voice in active.extraVoice" :key="voice.url"><p>{{ voice.name }}</p><audio :src="voice.url" controls preload="none"></audio></div>
            </div>
            <section v-if="mediaSlot || currentPrompt" class="prompt" :aria-label="$t('生成词')">
              <div class="prompt-heading">
                <strong>{{ $t('生成词') }}</strong>
                <button v-if="mediaSlot && promptDraft === null" class="secondary" :disabled="busy" @click="promptDraft = currentPrompt">
                  <component :is="currentPrompt ? 'Pencil' : 'Plus'" :size="14" aria-hidden="true" />
                  {{ currentPrompt ? $t('编辑生成词') : $t('添加生成词') }}
                </button>
              </div>
              <form id="character-prompt-form" v-if="promptDraft !== null" @submit.prevent="savePrompt">
                <label class="field"><span class="visually-hidden">{{ $t('{label}生成词', { label: $t(mediaSlot.label) }) }}</span><textarea v-model="promptDraft" rows="4" :disabled="busy"></textarea></label>
              </form>
              <pre v-else-if="currentPrompt">{{ currentPrompt }}</pre>
            </section>
          </template>
        </div>
        <footer class="dialog-footer overview-actions" v-if="activeTab === 'overview'">
          <AssetDeleteButton :asset-name="active.name" :busy="busy" @confirm="deleteAsset" />
          <a class="secondary codex-sync-link" :href="codexSyncUrl">{{ $t('用 Codex 同步到即梦') }}</a>
          <button type="button" class="secondary" :disabled="busy" @click="$refs.detail.close()">{{ $t('取消') }}</button>
          <button form="character-overview-form" type="submit" class="primary overview-save-button" :disabled="busy">{{ $t('保存') }}</button>
        </footer>
        <footer class="dialog-footer" v-if="mediaSlot && promptDraft !== null">
          <button type="button" class="secondary" :disabled="busy" @click="promptDraft = null">{{ $t('取消') }}</button>
          <button form="character-prompt-form" type="submit" class="primary" :disabled="busy">{{ $t('保存生成词') }}</button>
        </footer>
      </template>
    </dialog>
  </div>
</template>
