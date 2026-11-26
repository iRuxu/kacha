<script>
import { ElOption, ElSelect } from 'element-plus'
import 'element-plus/es/components/select/style/css'
import { AudioLines, BookOpen, Box, ChevronRight, CircleAlert, CircleCheck, Layers3, LoaderCircle, Mountain, Plug, Settings, Users, X } from 'lucide-vue-next'
import projectBrand from 'virtual:project-brand'
import { language, languages } from '@/i18n/index.js'

export default {
  components: { ElOption, ElSelect, AudioLines, BookOpen, Box, ChevronRight, CircleAlert, CircleCheck, Layers3, LoaderCircle, Mountain, Plug, Settings, Users, X },
  props: { sections: { type: Array, required: true } },
  data() {
    return {
      languages,
      logoFile: null,
      logoPreview: '',
      configSaving: false,
      configTab: 'basics',
      localeDraft: language.locale,
      localeError: false,
      storageLoading: false,
      storageDraft: { endpoint: '', bucket: '', prefix: '', keyId: '', secret: '' },
      storageStatus: { hasKeyId: false, hasSecret: false },
      storageError: '',
      storageTesting: false,
      storageTestResult: null,
      configError: false,
      configDraft: { name: '', description: '' },
      projectLogo: projectBrand.logo,
    }
  },
  computed: {
    projectName() {
      return projectBrand.name || 'Kacha'
    },
    projectDescription() {
      return projectBrand.description || this.$t('项目工作台')
    },
  },
  methods: {
    clearLogoDraft() {
      if (this.logoPreview) URL.revokeObjectURL(this.logoPreview)
      this.logoPreview = ''
      this.logoFile = null
    },
    selectLogo(event) {
      const file = event.target.files[0]
      event.target.value = ''
      if (!file) return
      this.configError = false
      if (!/\.(svg|png|webp|avif|jpg|jpeg|gif|ico|bmp)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) {
        this.configError = '请选择 2 MB 以内的受支持图片'
        return
      }
      this.clearLogoDraft()
      this.logoFile = file
      this.logoPreview = URL.createObjectURL(file)
    },
    async selectConfigTab(tab) {
      if (tab === this.configTab) return
      this.configTab = tab
      if (tab !== 'storage') return
      this.storageTestResult = null
      this.storageLoading = true
      this.storageError = ''
      try {
        const response = await fetch('/api/project-storage')
        if (!response.ok) throw new Error()
        const { endpoint, bucket, prefix, hasKeyId, hasSecret } = await response.json()
        this.storageDraft = { endpoint, bucket, prefix: prefix || '', keyId: '', secret: '' }
        this.storageStatus = { hasKeyId, hasSecret }
      } catch {
        this.storageError = '无法读取存储设置'
      } finally {
        this.storageLoading = false
      }
    },
    async saveProjectLocale() {
      if (this.configSaving) return
      this.configSaving = true
      this.localeError = false
      try {
        const response = await fetch('/api/project-global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: this.localeDraft }),
        })
        if (!response.ok) throw new Error()
        language.locale = this.localeDraft
        this.$refs.projectConfig.close()
      } catch {
        this.localeError = true
      } finally {
        this.configSaving = false
      }
    },
    async testProjectStorage() {
      if (this.storageTesting || this.storageLoading || this.configSaving) return
      this.storageTesting = true
      this.storageTestResult = null
      try {
        const response = await fetch('/api/project-storage/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const result = await response.json()
        this.storageTestResult = { ...result, ok: response.ok }
      } catch {
        this.storageTestResult = { ok: false }
      } finally {
        this.storageTesting = false
      }
    },
    async saveProjectStorage() {
      if (this.configSaving || this.storageLoading || this.storageTesting) return
      this.configSaving = true
      this.storageError = ''
      try {
        const response = await fetch('/api/project-storage', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.storageDraft),
        })
        if (!response.ok) {
          this.storageError = response.status === 400 ? '请检查 OSS 地址、Bucket 和访问凭据' : '无法保存存储设置'
          return
        }
        this.$refs.projectConfig.close()
      } catch {
        this.storageError = '无法保存存储设置'
      } finally {
        this.configSaving = false
      }
    },
    closeProjectConfig() {
      this.clearLogoDraft()
      this.storageDraft.keyId = ''
      this.storageDraft.secret = ''
    },
    openProjectConfig() {
      this.configTab = 'basics'
      this.localeDraft = language.locale
      this.localeError = false
      this.configDraft = { name: projectBrand.name, description: projectBrand.description }
      this.configError = false
      this.$refs.projectConfig.showModal()
    },
    async saveProjectConfig() {
      if (this.configSaving) return
      this.configSaving = true
      this.configError = false
      try {
        const payload = { ...this.configDraft }
        if (this.logoFile) {
          const file = this.logoFile
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          payload.logo = { extension: file.name.split('.').pop().toLowerCase(), data: dataUrl.split(',')[1] }
        }
        const response = await fetch('/api/project-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error()
        window.location.reload()
      } catch {
        this.configError = '无法保存项目设置'
        this.configSaving = false
      }
    },
  },
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon"><img v-if="projectLogo" :src="projectLogo" alt="" @error="projectLogo = ''" /><span v-else class="brand-rabbit" aria-hidden="true"></span></span><div><strong>{{ projectName }}</strong><small>{{ projectDescription }}</small></div></div>
      <nav :aria-label="$t('工作台')">
        <template v-for="(item, index) in sections" :key="item.name">
          <div v-if="item.group !== sections[index - 1]?.group" class="nav-title">{{ $t(item.group) }}</div>
          <RouterLink class="nav-link" :class="{ 'settings-nav': item.name === 'settings' }"
            :to="{ name: item.name }" exact-active-class="selected">
            <component :is="item.icon" :size="17" />{{ $t(item.label, {}, 'navigation') }}<ChevronRight class="nav-arrow" :size="14" />
          </RouterLink>
        </template>
      </nav>
    </aside>

    <main>
      <header class="topbar">
        <span>{{ $t($route.meta.group) }}</span>
        <ChevronRight :size="14" aria-hidden="true" />
        <strong>{{ $t($route.meta.label) }}</strong>
        <div class="topbar-actions">
          <button type="button" class="topbar-icon-button project-config-trigger" :aria-label="$t('全局设置')"
            :title="$t('全局设置')" aria-haspopup="dialog" @click="openProjectConfig">
            <Settings :size="17" aria-hidden="true" />
          </button>
        </div>
      </header>
      <dialog ref="projectConfig" class="dialog asset-detail-dialog project-config-dialog"
        aria-labelledby="project-config-title" @close="closeProjectConfig"
        @cancel.prevent="!configSaving && !storageTesting && $refs.projectConfig.close()">
        <header class="dialog-head">
          <h2 id="project-config-title">{{ $t('全局设置') }}</h2>
          <button type="button" class="icon-button" :aria-label="$t('关闭')" :disabled="configSaving || storageTesting"
            @click="$refs.projectConfig.close()"><X :size="20" /></button>
        </header>
        <div class="tabs" role="tablist">
          <button id="project-basics-tab" type="button" role="tab" :class="{ current: configTab === 'basics' }"
            :aria-selected="configTab === 'basics'" aria-controls="project-basics-panel" :disabled="configSaving || storageLoading || storageTesting"
            @click="selectConfigTab('basics')">{{ $t('基本信息') }}</button>
          <button id="project-storage-tab" type="button" role="tab" :class="{ current: configTab === 'storage' }"
            :aria-selected="configTab === 'storage'" aria-controls="project-storage-panel" :disabled="configSaving || storageLoading || storageTesting"
            @click="selectConfigTab('storage')">{{ $t('存储设置') }}</button>
          <button id="project-other-tab" type="button" role="tab" :class="{ current: configTab === 'other' }"
            :aria-selected="configTab === 'other'" aria-controls="project-other-panel" :disabled="configSaving || storageLoading || storageTesting"
            @click="selectConfigTab('other')">{{ $t('其它设置') }}</button>
        </div>
        <div v-show="configTab === 'basics'" id="project-basics-panel" class="dialog-body" role="tabpanel" aria-labelledby="project-basics-tab">
          <form id="project-config-form" class="project-config-form" @submit.prevent="saveProjectConfig">
            <label class="field">
              <span>{{ $t('项目名称') }}</span>
              <input v-model="configDraft.name" :disabled="configSaving" />
            </label>
            <label class="field">
              <span>{{ $t('项目描述') }}</span>
              <input v-model="configDraft.description" :disabled="configSaving" />
            </label>
            <div class="field">
              <span>{{ $t('项目 Logo') }}</span>
              <div class="project-logo-field">
                <span class="brand-icon">
                  <img v-if="logoPreview || projectLogo" :src="logoPreview || projectLogo" alt="" />
                  <span v-else class="brand-rabbit" aria-hidden="true"></span>
                </span>
                <label class="secondary upload">
                  {{ $t('更换 Logo') }}
                  <input type="file" accept=".svg,.png,.webp,.avif,.jpg,.jpeg,.gif,.ico,.bmp" :disabled="configSaving" @change="selectLogo" />
                </label>
                <span v-if="logoFile">{{ logoFile.name }}</span>
              </div>
            </div>
            <p v-if="configError" class="project-config-error" role="alert">{{ $t(configError) }}</p>
          </form>
        </div>
        <div v-if="configTab === 'storage'" id="project-storage-panel" class="dialog-body" role="tabpanel" aria-labelledby="project-storage-tab">
          <form id="project-storage-form" class="project-config-form" autocomplete="off" @submit.prevent="saveProjectStorage">
            <label class="field">{{ $t('OSS 地址') }}
              <input v-model.trim="storageDraft.endpoint" placeholder="oss-cn-hangzhou.aliyuncs.com" required :disabled="storageLoading || configSaving" />
            </label>
            <label class="field">{{ $t('Bucket 名称') }}
              <input v-model.trim="storageDraft.bucket" required :disabled="storageLoading || configSaving" />
            </label>
            <label class="field">{{ $t('路径') }}
              <input v-model.trim="storageDraft.prefix" :placeholder="$t('留空使用 Bucket 根目录')" :disabled="storageLoading || configSaving" />
            </label>
            <label class="field">AccessKey ID
              <input v-model.trim="storageDraft.keyId" :placeholder="storageStatus.hasKeyId ? $t('已配置，留空保留') : ''"
                :required="!storageStatus.hasKeyId" :disabled="storageLoading || configSaving" />
            </label>
            <label class="field">AccessKey Secret
              <input v-model.trim="storageDraft.secret" type="password" autocomplete="new-password"
                :placeholder="storageStatus.hasSecret ? $t('已配置，留空保留') : ''"
                :required="!storageStatus.hasSecret" :disabled="storageLoading || configSaving" />
            </label>
            <div v-if="storageTestResult" class="storage-test-result"
              :class="{ 'is-success': storageTestResult.ok }" role="status">
              <component :is="storageTestResult.ok ? 'CircleCheck' : 'CircleAlert'" :size="18" aria-hidden="true" />
              <div class="storage-test-detail">
                <p>
                  {{ $t(storageTestResult.ok ? '上传成功，读回内容一致。' : ({
                    config: '无法使用已保存的 OSS 配置，请检查设置。',
                    upload: 'OSS 测试文件上传失败。',
                    read: '测试文件已上传，但无法读回。',
                    verify: '读回内容与测试文件不一致。',
                  }[storageTestResult.step] || '测试连接失败。')) }}
                  <span v-if="storageTestResult.status">(HTTP {{ storageTestResult.status }})</span>
                </p>
                <code v-if="storageTestResult.object">{{ storageTestResult.bucket ? storageTestResult.bucket + '/' : '' }}{{ storageTestResult.object }}</code>
              </div>
            </div>
            <p v-if="storageError" class="project-config-error" role="alert">{{ $t(storageError) }}</p>
          </form>
        </div>
        <div v-if="configTab === 'other'" id="project-other-panel" class="dialog-body" role="tabpanel" aria-labelledby="project-other-tab">
          <form id="project-other-form" class="project-config-form" @submit.prevent="saveProjectLocale">
            <div class="field">
              <label for="project-locale">{{ $t('语言') }}</label>
              <ElSelect id="project-locale" v-model="localeDraft" :teleported="false" :disabled="configSaving">
                <ElOption v-for="(label, locale) in languages" :key="locale" :value="locale" :label="label" :lang="locale" />
              </ElSelect>
            </div>
            <p v-if="localeError" class="project-config-error" role="alert">{{ $t('无法保存语言设置') }}</p>
          </form>
        </div>
        <footer class="dialog-footer">
          <button v-if="configTab === 'storage'" type="button" class="secondary storage-test-button"
            :disabled="configSaving || storageLoading || storageTesting" @click="testProjectStorage">
            <LoaderCircle v-if="storageTesting" class="storage-test-spinner" :size="16" aria-hidden="true" />
            <Plug v-else :size="16" aria-hidden="true" />
            {{ $t(storageTesting ? '正在测试…' : '测试连接') }}
          </button>
          <button type="button" class="secondary" :disabled="configSaving || storageTesting" @click="$refs.projectConfig.close()">{{ $t('取消') }}</button>
          <button :form="configTab === 'basics' ? 'project-config-form' : 'project-' + configTab + '-form'" type="submit" class="primary" :disabled="configSaving || storageLoading || storageTesting">{{ $t('保存') }}</button>
        </footer>
      </dialog>
      <RouterView v-slot="{ Component, route }">
        <KeepAlive include="CharacterAssets">
          <component :is="Component" :key="route.name" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
</template>
