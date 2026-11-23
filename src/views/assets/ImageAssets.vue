<script>
import AssetDeleteButton from '@/components/AssetDeleteButton.vue'
import AssetHistory from '@/components/AssetHistory.vue'
import AssetStoryEditor from '@/components/AssetStoryEditor.vue'
import AssetTagInput from '@/components/AssetTagInput.vue'
import ProjectMarkdown from '@/components/ProjectMarkdown.vue'
import { requestAsset } from '@/service/assets.js'
import { Image, Pencil, Plus, RefreshCw, Search, Upload, X } from 'lucide-vue-next'

export default {
  components: { AssetDeleteButton, AssetHistory, AssetStoryEditor, AssetTagInput, ProjectMarkdown, Image, Pencil, Plus, RefreshCw, Search, Upload, X },
  props: { kind: { type: String, default: 'scenes' } },
  data() {
    return {
      scenes: [], tagFilters: [], query: '', createTags: [], overviewDraft: {}, scene: null, tab: 'cover', category: '', selectedId: '',
      imageForm: null, storyDraft: null, promptDraft: null, create: false, name: '',
      busy: false, error: '', pageError: '', revision: 0,
    }
  },
  computed: {
    isScene() {
      return this.kind === 'scenes'
    },
    isProp() {
      return this.kind === 'props'
    },
    isOther() {
      return this.kind === 'other'
    },
    assetLabel() {
      return this.isProp ? '道具' : this.isOther ? '其他' : '场景'
    },
    changeEvent() {
      return 'workbench:' + this.kind + ':changed'
    },
    availableTags() {
      return [...new Set(this.scenes.flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },
    visibleScenes() {
      const query = this.query.trim().toLowerCase()
      return this.scenes.filter(scene => {
        const tags = scene.tags || []
        return this.tagFilters.every(tag => tags.includes(tag))
          && [scene.name, ...tags, ...scene.groupPath].some(value => value.toLowerCase().includes(query))
      })
    },
    detailTabs() {
      const galleries = this.isOther
        ? [{ key: 'images', name: '扩展' }]
        : Object.entries(this.scene.groups).map(([key, name]) => ({ key, name }))
      return [
        { key: 'overview', name: '概览' },
        { key: 'cover', name: '主图' },
        ...galleries,
        { key: 'story', name: this.isOther ? '说明' : this.assetLabel + '说明' },
        { key: 'history', name: '历史版本' },
      ]
    },
    simpleCover() {
      return !this.isScene && this.tab === 'cover'
    },
    inGallery() {
      return this.isOther ? this.tab === 'images' : Object.hasOwn(this.scene?.groups ?? {}, this.tab)
    },
    filteredImages() {
      return this.scene.images.filter(image => image.id !== this.scene.cover?.id
        && (!this.category || image.category === this.category))
    },
    activeImage() {
      return this.tab === 'cover' ? this.scene.cover : this.scene.images.find(image => image.id === this.selectedId)
    },
    storyPath() {
      const id = this.scene.id.split('/').map(encodeURIComponent).join('/')
      return `assets/${this.kind}/${id}/README.md`
    },
  },
  beforeRouteLeave() {
    if (this.busy) return false
  },
  mounted() {
    this.refresh()
    import.meta.hot?.on(this.changeEvent, this.refreshAssets)
  },
  beforeUnmount() {
    import.meta.hot?.off(this.changeEvent, this.refreshAssets)
  },
  methods: {
    toggleTag(tag) {
      this.tagFilters = this.tagFilters.includes(tag)
        ? this.tagFilters.filter(value => value !== tag)
        : [...this.tagFilters, tag]
    },
    async refreshAssets() {
      await this.refresh()
      const scene = this.scene
      if (!scene || this.busy || this.imageForm || this.storyDraft !== null || this.promptDraft !== null
        || !this.scenes.some(item => item.id === scene.id)) return
      try {
        const detail = await requestAsset(this.kind, scene.id)
        if (this.scene !== scene || this.busy || this.imageForm || this.storyDraft !== null || this.promptDraft !== null) return
        this.scene = detail
        if (this.inGallery) this.filterImages(this.category)
      } catch (cause) {
        if (this.scene === scene) this.error = cause.message
      }
    },
    async refresh() {
      const revision = ++this.revision
      try {
        const scenes = await requestAsset(this.kind)
        if (revision !== this.revision) return
        this.scenes = scenes
        this.tagFilters = this.tagFilters.filter(tag => this.availableTags.includes(tag))
        this.pageError = ''
      } catch (cause) {
        if (revision === this.revision) this.pageError = cause.message
      }
    },
    async open(item) {
      this.busy = true
      try {
        this.scene = await requestAsset(this.kind, item.id)
        this.overviewDraft = {}
        this.category = ''
        this.selectedId = this.scene.cover?.id || ''
        this.changeTab('overview')
        this.$refs.detail.showModal()
      } catch (cause) {
        this.pageError = cause.message
      } finally {
        this.busy = false
      }
    },
    showCreate() {
      this.error = ''
      this.name = ''
      this.createTags = []
      this.create = true
      this.$refs.create.showModal()
    },
    async createScene() {
      this.busy = true
      this.error = ''
      try {
        const scene = await requestAsset(this.kind, null, 'POST', {
          name: this.name.trim(),
          tags: this.createTags,
        })
        this.$refs.create.close()
        await this.open(scene)
        await this.refresh()
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    closeDetail() {
      this.scene = null
      this.overviewDraft = {}
      this.error = ''
      this.imageForm = null
      this.storyDraft = null
      this.promptDraft = null
    },
    changeTab(tab) {
      this.error = ''
      this.imageForm = null
      this.storyDraft = null
      this.promptDraft = null
      this.tab = tab
      if (this.$refs.detailBody) this.$refs.detailBody.scrollTop = 0
      if (this.inGallery) this.filterImages(this.isOther ? '' : tab, !this.isScene)
    },
    filterImages(category, resetSelection = false) {
      this.category = category
      this.imageForm = null
      if (resetSelection || !this.filteredImages.some(image => image.id === this.selectedId)) {
        this.selectedId = this.filteredImages[0]?.id || ''
      }
    },
    selectImage(id) {
      if (this.selectedId === id) return
      this.selectedId = id
      this.imageForm = null
      this.promptDraft = null
      this.error = ''
    },
    defaultImageCategory() {
      if (this.isOther) return 'graphic'
      if (this.inGallery) return this.category
      return this.isProp ? 'angle' : 'view'
    },
    editImage(image = null, replaceFile = true) {
      this.error = ''
      this.promptDraft = null
      this.imageForm = {
        id: image?.id,
        label: image?.label || (this.simpleCover ? '主图' : ''),
        category: image?.category || this.defaultImageCategory(),
        status: image?.status || 'candidate',
        prompt: replaceFile ? '' : image.prompt || '',
        conditions: { ...image?.conditions },
        replaceFile,
        file: null,
      }
    },
    async save(patch) {
      this.busy = true
      this.error = ''
      try {
        this.scene = await requestAsset(this.kind, this.scene.id, 'PATCH', patch)
        await this.refresh()
        return true
      } catch (cause) {
        this.error = cause.message
        return false
      } finally {
        this.busy = false
      }
    },
    async uploadImage() {
      const { file, replaceFile, ...image } = this.imageForm
      if (replaceFile && !file) return
      if (file?.size > 30 * 1024 * 1024) {
        this.error = this.$t('请选择 30 MB 以内的图片')
        return
      }
      this.busy = true
      try {
        const base64 = file && await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = () => reject(new Error(this.$t('读取图片失败')))
          reader.readAsDataURL(file)
        })
        const previousIds = new Set(this.scene.images.map(item => item.id))
        const main = this.tab === 'cover'
        const upload = file ? { filename: file.name, base64, main } : {}
        if (await this.save({ image: { ...image, ...upload } })) {
          this.selectedId = image.id || this.scene.images.find(item => !previousIds.has(item.id))?.id || ''
          this.changeTab(main ? 'cover' : image.category)
        }
      } catch (cause) {
        this.error = cause.message
      } finally {
        this.busy = false
      }
    },
    async deleteAsset() {
      if (this.busy || !this.scene) return
      this.busy = true
      this.error = ''
      try {
        await requestAsset(this.kind, this.scene.id, 'DELETE', {})
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
    async saveImagePrompt() {
      if (await this.save({ image: { id: this.activeImage.id, prompt: this.promptDraft } })) this.promptDraft = null
    },
  },
}
</script>

<template>
  <section class="content">
    <div class="heading">
      <div><h1>{{ $t(assetLabel + '资产') }}</h1><p>{{ $t('{count} 个' + assetLabel, { count: scenes.length }) }}</p></div>
      <button class="primary" :disabled="busy" @click="showCreate"><Plus :size="18" /> {{ $t('新建' + assetLabel) }}</button>
    </div>
    <div class="tools">
      <label class="search"><Search :size="17" /><input v-model="query" :placeholder="$t('搜索名称或标签')" :aria-label="$t('搜索名称或标签')"></label>
      <div v-if="availableTags.length" class="filter-list" :aria-label="$t('按标签筛选')">
        <button class="tag" :class="{ chosen: !tagFilters.length }" :aria-pressed="!tagFilters.length" @click="tagFilters = []">{{ $t('全部') }}</button>
        <button v-for="tag in availableTags" :key="tag" class="tag" :class="{ chosen: tagFilters.includes(tag) }"
          :aria-pressed="tagFilters.includes(tag)" @click="toggleTag(tag)">{{ tag }}</button>
      </div>
    </div>
    <p v-if="pageError" class="error" role="alert">{{ pageError }}</p>
    <p v-else-if="!visibleScenes.length" class="empty">{{ $t('没有匹配的' + assetLabel) }}</p>
    <div class="grid">
      <article v-for="item in visibleScenes" :key="item.id" class="card scene-card">
        <button class="cover" :class="{ 'transparent-preview': kind === 'other' || item.transparentPreview || item.cover?.category === 'graphic' }" :aria-label="$t('查看 {name}', { name: item.name })" :disabled="busy" @click="open(item)">
          <img v-if="item.cover?.url" :src="item.cover.url" :alt="item.cover.label" loading="lazy">
          <span v-else class="placeholder"><Image :size="24" />{{ $t('待补主图') }}</span>
        </button>
        <div class="scene-card-info">
          <button class="character-name" :disabled="busy" @click="open(item)">{{ item.name }}</button>
          <div v-if="item.tags?.length" class="card-tags image-card-tags">
            <button v-for="tag in item.tags" :key="tag" class="tag compact" :aria-pressed="tagFilters.includes(tag)"
              :class="{ chosen: tagFilters.includes(tag) }" @click="toggleTag(tag)">{{ tag }}</button>
          </div>
          <p v-else-if="!isProp && item.groupPath.length" class="asset-group-path">{{ item.groupPath.join(' / ') }}</p>
          <small>{{ $t('{count} 张图', { count: item.count }) }}<span v-if="item.cover?.status === 'candidate'"> · {{ $t('候选封面') }}</span></small>
        </div>
      </article>
    </div>

    <dialog ref="create" class="dialog small-dialog" @close="create = false" @cancel.prevent="!busy && $refs.create.close()">
      <form v-if="create" @submit.prevent="createScene">
        <header class="dialog-head"><h2>{{ $t('新建' + assetLabel) }}</h2><button type="button" class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.create.close()"><X :size="20" /></button></header>
        <div class="dialog-body">
          <label class="field">{{ $t(assetLabel + '名') }}<input v-model="name" required autofocus></label>
          <div class="asset-tag-field">
            <label class="field" for="create-image-asset-tags">{{ $t('标签') }}</label>
            <AssetTagInput id="create-image-asset-tags" v-model="createTags" :disabled="busy" />
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="dialog-actions create-actions">
            <button class="primary" :disabled="busy">{{ $t('创建' + assetLabel) }}</button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog ref="detail" class="dialog scene-dialog asset-detail-dialog"
      @close="closeDetail" @cancel.prevent="!busy && !$event.currentTarget.querySelector('.asset-delete-message') && $refs.detail.close()">
      <template v-if="scene">
        <header class="dialog-head">
          <div>
            <h2>{{ scene.name }}</h2>
            <div v-if="scene.tags?.length" class="card-tags">
              <span v-for="tag in scene.tags" :key="tag" class="tag compact">{{ tag }}</span>
            </div>
            <p v-else-if="scene.groupPath.length" class="asset-group-path">{{ scene.groupPath.join(' / ') }}</p>
          </div>
          <button class="icon-button" :aria-label="$t('关闭')" :disabled="busy" @click="$refs.detail.close()"><X :size="20" /></button>
        </header>
        <div class="tabs">
          <button v-for="entry in detailTabs"
            :key="entry.key" :disabled="busy" :class="{ current: tab === entry.key }" :aria-pressed="tab === entry.key"
            @click="changeTab(entry.key)">{{ $t(entry.name) }}</button>
        </div>
        <div ref="detailBody" class="dialog-body">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <form v-if="tab === 'overview'" class="edit-form" @submit.prevent="saveOverview">
            <label class="field">{{ $t('名称') }}
              <input :value="overviewDraft.name ?? scene.name" required :disabled="busy"
                @input="overviewDraft.name = $event.target.value">
            </label>
            <div class="asset-tag-field">
              <label class="field" for="image-asset-tags">{{ $t('标签') }}</label>
              <AssetTagInput id="image-asset-tags" :model-value="overviewDraft.tags ?? scene.tags ?? []" :disabled="busy"
                @update:model-value="overviewDraft.tags = $event" />
            </div>
            <label class="field">{{ $t('备注') }}
              <textarea :value="overviewDraft.note ?? scene.note" rows="8" :placeholder="$t('写点笔记…')" :disabled="busy"
                @input="overviewDraft.note = $event.target.value"></textarea>
            </label>
            <div class="dialog-actions overview-actions">
              <AssetDeleteButton :asset-name="scene.name" :busy="busy" @confirm="deleteAsset" />
              <button class="primary overview-save-button" :disabled="busy">{{ $t('保存') }}</button>
            </div>
          </form>
          <template v-else-if="tab === 'cover' || inGallery">
            <div v-if="inGallery && filteredImages.length" class="scene-thumbnails"
              :class="{ 'contain-thumbnails': !isScene }" :aria-label="isOther ? $t('扩展图片') : $t('{category}图片', { category: $t(scene.groups[tab]) })">
              <button v-for="image in filteredImages" :key="image.id" :disabled="busy" :aria-pressed="selectedId === image.id" @click="selectImage(image.id)">
                <img v-if="image.url" :src="image.url" alt="" loading="lazy"><span>{{ image.label }}</span>
              </button>
            </div>
            <form v-if="imageForm" class="edit-form scene-edit" @submit.prevent="uploadImage">
              <fieldset class="scene-image-fields" :disabled="busy">
                <label v-if="!simpleCover && (!isProp || imageForm.replaceFile)" class="field">{{ $t('图片名称') }}<input v-model="imageForm.label" required></label>
                <div v-if="!simpleCover && (!isProp || imageForm.replaceFile)" class="scene-field-row">
                  <label v-if="!isProp && (!isScene || (imageForm.replaceFile && inGallery))" class="field">{{ $t('分类') }}<select v-model="imageForm.category"><option v-for="(label, key) in scene.groups" :key="key" :value="key">{{ $t(label) }}</option></select></label>
                  <label class="field">{{ $t('采用状态') }}<select v-model="imageForm.status"><option v-for="(label, key) in scene.statuses" :key="key" :value="key">{{ $t(label) }}</option></select></label>
                </div>
                <label v-if="imageForm.replaceFile" class="field">{{ $t('选择图片') }}<input type="file" accept=".png,.jpg,.jpeg,.webp,.avif" required @change="imageForm.file = $event.target.files[0]"></label>
                <div v-if="isScene" class="scene-field-row scene-conditions">
                  <label v-for="key in ['season', 'time', 'weather']" :key="key" class="field">{{ $t('{category}（选填）', { category: $t(scene.groups[key]) }) }}<input v-model="imageForm.conditions[key]"></label>
                </div>
                <label class="field">{{ $t('生成词') }}<textarea v-model="imageForm.prompt" rows="4"></textarea></label>
                <div class="dialog-actions create-actions">
                  <button type="button" class="secondary" @click="imageForm = null; error = ''">{{ $t('取消') }}</button>
                  <button class="primary">{{ $t(imageForm.replaceFile ? '保存图片' : '保存资料') }}</button>
                </div>
              </fieldset>
            </form>
            <template v-else-if="activeImage">
              <a v-if="activeImage.url" :href="activeImage.url" target="_blank" rel="noopener noreferrer">
                <img class="detail-image" :class="{ 'transparent-preview': kind === 'other' || scene.transparentPreview || activeImage.category === 'graphic' }" :src="activeImage.url" :alt="activeImage.label">
              </a>
              <p v-else class="empty">{{ $t('找不到图片文件 {file}', { file: activeImage.file }) }}</p>
              <div v-if="tab === 'cover'" class="media-actions">
                <button type="button" class="secondary" :disabled="busy" @click="editImage(activeImage)">
                  <RefreshCw v-if="activeImage.url" :size="14" />
                  <Upload v-else :size="15" />
                  {{ activeImage.url ? $t('替换主图') : $t('上传主图') }}
                </button>
              </div>
              <div v-else class="scene-toolbar scene-image-info">
                <div>
                  <strong>{{ activeImage.label }}</strong>
                </div>
              </div>
              <section v-if="tab === 'cover' && activeImage.url" class="prompt" :aria-label="$t('生成词')">
                <div class="prompt-heading">
                  <strong>{{ $t('生成词') }}</strong>
                  <button v-if="promptDraft === null" type="button" class="secondary" :disabled="busy"
                    @click="promptDraft = activeImage.prompt || ''; error = ''">
                    <component :is="activeImage.prompt ? 'Pencil' : 'Plus'" :size="14" aria-hidden="true" />
                    {{ activeImage.prompt ? $t('编辑生成词') : $t('添加生成词') }}
                  </button>
                </div>
                <form v-if="promptDraft !== null" @submit.prevent="saveImagePrompt">
                  <label class="field"><span class="visually-hidden">{{ $t('图片生成词') }}</span>
                    <textarea v-model="promptDraft" rows="4" :disabled="busy"></textarea>
                  </label>
                  <div class="dialog-actions">
                    <button class="primary" :disabled="busy">{{ $t('保存生成词') }}</button>
                    <button type="button" class="secondary" :disabled="busy" @click="promptDraft = null; error = ''">{{ $t('取消') }}</button>
                  </div>
                </form>
                <pre v-else-if="activeImage.prompt">{{ activeImage.prompt }}</pre>
              </section>
              <section v-else-if="activeImage.prompt" class="prompt"><strong>{{ $t('生成词') }}</strong><pre>{{ activeImage.prompt }}</pre></section>
            </template>
            <template v-else>
              <div class="detail-placeholder"><Image :size="25" />{{ tab === 'cover' ? $t('待补主图') : $t('暂无图片') }}</div>
              <button v-if="tab === 'cover'" class="secondary" :disabled="busy" @click="editImage()"><Upload :size="15" />{{ $t('上传主图') }}</button>
            </template>
          </template>
          <AssetStoryEditor v-else-if="tab === 'story'" v-model:draft="storyDraft" :busy="busy"
            @edit="storyDraft = scene.story; error = ''" @cancel="storyDraft = null; error = ''" @save="saveStory">
            <ProjectMarkdown v-if="scene.story" :source="scene.story" :file="storyPath" />
            <p v-else class="empty">{{ $t('还没有' + (isOther ? '' : assetLabel) + '说明。') }}</p>
          </AssetStoryEditor>
          <AssetHistory v-else-if="tab === 'history'" :versions="scene.history" :group="kind + '-history'">
            <template #description="{ version }"><small v-if="version.note">{{ version.note }}</small></template>
            <template #default="{ version }">
              <div v-for="image in version.images" :key="image.file">
                <strong>{{ image.label }}</strong>
                <a v-if="image.url" :href="image.url" target="_blank" rel="noopener noreferrer"><img :src="image.url" :alt="image.label" loading="lazy"></a>
                <div v-if="image.prompt" class="prompt"><strong>{{ $t('生成词') }}</strong><pre>{{ image.prompt }}</pre></div>
              </div>
              <ProjectMarkdown v-if="version.story" :source="version.story" :file="storyPath" />
            </template>
          </AssetHistory>
        </div>
      </template>
    </dialog>
  </section>
</template>
