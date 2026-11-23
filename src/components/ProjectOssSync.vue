<script>
import { h } from 'vue'
import { ElCheckbox, ElNotification, ElProgress, ElRadioButton, ElRadioGroup } from 'element-plus'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/progress/style/css'
import 'element-plus/es/components/radio-button/style/css'
import 'element-plus/es/components/radio-group/style/css'
import 'element-plus/es/components/notification/style/css'
import { CircleAlert, CircleCheck, CloudDownload, CloudUpload, LoaderCircle, RefreshCw, X } from 'lucide-vue-next'

const endpoint = '/api/project-oss-sync'
const settingsErrors = ['OSS_NOT_CONFIGURED', 'OSS_INVALID_CONFIG']
const fileErrors = {
  OSS_SYNC_FILE_CHANGED: '文件在同步期间发生变化',
  OSS_SYNC_FILE_UNREADABLE: '无法读取文件',
  OSS_SYNC_UPLOAD_FAILED: '文件上传失败',
  OSS_SYNC_DOWNLOAD_FAILED: '文件下载失败',
  OSS_SYNC_HASH_MISMATCH: '下载文件校验失败',
  OSS_SYNC_REMOVE_FAILED: '无法移除文件',
}
const syncErrors = {
  OSS_SYNC_BUSY: '另一个工作台实例正在同步',
  OSS_SYNC_SCAN_FAILED: '无法扫描项目文件',
  OSS_SYNC_STATE_FAILED: '无法保存同步进度',
  OSS_COLLAB_PREVIEW_STALE: '项目或云端版本已变化，请重新预览',
  OSS_COLLAB_RESOLUTION_REQUIRED: '请选择每个冲突文件的处理方式',
  OSS_COLLAB_DELETE_CONFIRMATION_REQUIRED: '请确认本次移除操作',
  OSS_COLLAB_PROJECT_MISMATCH: '本地项目与云端项目不一致',
  OSS_COLLAB_REMOTE_CHANGED: '同事已发布新版本，请重新预览',
  OSS_COLLAB_REMOTE_INVALID: '云端项目清单无效',
  OSS_COLLAB_REMOTE_IO: '无法读取或写入云端项目',
  OSS_COLLAB_LEGACY_LOCAL_REQUIRED: '需要原项目文件才能迁移旧版备份',
  OSS_SYNC_BASELINE_INVALID: '本地同步清单无效',
  OSS_COLLAB_EMPTY_PROJECT: '当前项目没有可同步的文件',
  OSS_COLLAB_PATH_COLLISION: '本地和云端存在冲突路径，请调整文件名后重新预览',
  OSS_SYNC_FILE_CHANGED: '文件在同步期间发生变化',
  OSS_SYNC_FILE_UNREADABLE: '无法读取文件',
}

export default {
  components: {
    CircleAlert, CircleCheck, CloudDownload, CloudUpload, ElCheckbox, ElProgress, ElRadioButton,
    ElRadioGroup, LoaderCircle, RefreshCw, X,
  },
  emits: ['configure-storage'],
  data() {
    return {
      status: { state: 'idle' },
      fileErrors,
      starting: false,
      connectionError: false,
      timer: null,
      request: null,
      notificationTarget: 'body',
      modalObserver: null,
      failureReport: null,
      plan: null,
      planRequest: null,
      planLoading: false,
      planError: '',
      resolutions: Object.create(null),
      confirmDeletes: false,
    }
  },
  computed: {
    running() {
      return this.starting || this.status.state === 'running'
    },
    showTopbarCount() {
      return this.running && !this.starting && this.status.total > 0
    },
    triggerLabel() {
      if (!this.running) return this.$t('同步到 OSS')
      if (!this.showTopbarCount) return this.$t(this.statusLabel)
      return this.$t('已处理 {count} / {total} 个文件', {
        count: this.counts.processed,
        total: this.status.total,
      })
    },
    configRequired() {
      return settingsErrors.includes(this.planError) ||
        (!this.plan && !this.planLoading && settingsErrors.includes(this.status.error))
    },
    target() {
      return this.running ? this.status.target : (this.plan?.target || this.status.target)
    },
    counts() {
      const { uploaded = 0, downloaded = 0, removed = 0, skipped = 0, failed = 0 } = this.status
      return { uploaded, downloaded, removed, skipped, failed, processed: uploaded + downloaded + removed + skipped + failed }
    },
    resultStats() {
      const { uploaded, downloaded, removed, skipped, failed } = this.counts
      return [
        { label: '已上传', count: uploaded },
        { label: '已下载', count: downloaded },
        { label: '已移除', count: removed },
        { label: '已跳过', count: skipped },
        { label: '失败', count: failed },
      ]
    },
    percentage() {
      if (this.status.state === 'completed') return 100
      const { currentPercent = 0, total = 0 } = this.status
      if (!total) return 0
      return Math.min(100, Math.floor((this.counts.processed + currentPercent / 100) / total * 100))
    },
    statusLabel() {
      if (this.starting) return '正在启动同步'
      if (this.planLoading) return '正在生成同步预览'
      if (this.configRequired) return '请先保存 OSS 存储设置'
      if (this.planError) return syncErrors[this.planError] || '无法生成同步预览'
      if (!this.running && this.plan) return this.plan.mode === 'noop' ? '本地与云端已同步' : '同步预览'
      if (syncErrors[this.status.error]) return syncErrors[this.status.error]
      switch (this.status.state) {
        case 'running':
          if (this.status.phase === 'scanning') return '正在扫描项目'
          if (this.status.phase === 'publishing') return '正在发布云端版本'
          if (this.status.phase === 'downloading' || this.status.action === 'download') return '正在下载项目'
          return '正在同步项目'
        case 'completed':
          return this.status.action === 'download' ? '下载完成' : '同步完成'
        case 'failed':
          return this.status.failed ? '有文件未同步' : '同步失败'
        case 'interrupted':
          return '同步已中断'
        default:
          return '等待同步'
      }
    },
    statusIcon() {
      if (this.running || this.planLoading) return 'LoaderCircle'
      if (this.planError || this.configRequired) return 'CircleAlert'
      if (this.plan) return this.plan.mode === 'noop' ? 'CircleCheck' : 'CloudUpload'
      if (this.status.state === 'completed') return 'CircleCheck'
      if (this.status.state === 'idle' && !this.configRequired) return 'CloudUpload'
      return 'CircleAlert'
    },
    dialogState() {
      if (this.running || this.planLoading) return 'running'
      if (this.configRequired || this.planError) return 'failed'
      if (this.plan) return this.plan.mode === 'noop' ? 'completed' : 'idle'
      return this.status.state
    },
    canDownload() {
      const p = this.plan
      return Boolean(p?.revision && (p.mode === 'download' || p.download?.length || p.removeLocal?.length || p.conflicts?.length))
    },
    canSync() {
      return ['initialize', 'migrate', 'sync'].includes(this.plan?.mode)
    },
    unresolvedConflicts() {
      return this.plan?.conflicts?.filter(({ file }) => !this.resolutions[file]).length || 0
    },
    downloadDeletes() {
      return Boolean(this.plan?.removeLocal?.length || this.plan?.conflicts?.some(({ file, remote }) => !remote && this.resolutions[file] === 'remote'))
    },
    syncDeletes() {
      return Boolean(this.downloadDeletes || this.plan?.removeRemote?.length ||
        this.plan?.conflicts?.some(({ file, local }) => !local && this.resolutions[file] === 'local'))
    },
    deletionConfirmationVisible() {
      return (this.canDownload && this.downloadDeletes) || (this.canSync && this.syncDeletes)
    },
    planGroups() {
      if (!this.plan) return []
      const { upload, download, removeLocal, removeRemote } = this.plan
      return [
        { label: '待下载', files: download },
        { label: '待上传', files: upload },
        { label: '从本地移除', files: removeLocal },
        { label: '从云端版本移除', files: removeRemote },
      ].filter(group => group.files?.length)
    },
    syncActionLabel() {
      if (this.plan?.mode === 'initialize') return '发布初始版本'
      if (this.plan?.mode === 'migrate') return '迁移并发布'
      return '开始同步'
    },
  },
  mounted() {
    const updateNotificationTarget = () => {
      this.notificationTarget = Array.from(document.querySelectorAll('dialog:modal')).at(-1) || 'body'
    }
    this.modalObserver = new MutationObserver(updateNotificationTarget)
    this.modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
    updateNotificationTarget()
    this.updateStatus()
  },
  beforeUnmount() {
    this.modalObserver?.disconnect()
    window.clearTimeout(this.timer)
    this.request?.abort()
    this.planRequest?.abort()
  },
  methods: {
    open() {
      if (this.$refs.dialog.open) return
      this.$refs.dialog.showModal()
      if (!this.running) this.loadPlan()
    },
    async loadPlan() {
      if (this.running) return
      this.planRequest?.abort()
      const request = new AbortController()
      this.planRequest = request
      this.plan = null
      this.resolutions = Object.create(null)
      this.confirmDeletes = false
      this.planError = ''
      this.planLoading = true
      try {
        const response = await fetch(endpoint + '/plan', { signal: request.signal, cache: 'no-store' })
        const plan = await response.json()
        if (request.signal.aborted) return
        if (!response.ok || typeof plan?.id !== 'string') {
          this.planError = plan?.error || 'OSS_SYNC_PLAN_FAILED'
          return
        }
        this.plan = plan
      } catch {
        if (!request.signal.aborted) this.planError = 'OSS_SYNC_PLAN_FAILED'
      } finally {
        if (!request.signal.aborted) {
          this.planLoading = false
          this.planRequest = null
        }
      }
    },
    openStorage() {
      this.$refs.dialog.close()
      this.$emit('configure-storage')
    },
    resolveConflict(file, choice) {
      this.resolutions[file] = choice
      this.confirmDeletes = false
    },
    formatSize(size) {
      if (size < 1024) return size + ' B'
      const units = ['KiB', 'MiB', 'GiB', 'TiB']
      let unit = 0
      for (size /= 1024; size >= 1024 && unit < units.length - 1; unit++) size /= 1024
      return size.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + units[unit]
    },
    start(action) {
      const downloadOnly = action === 'download'
      if (this.running || this.planLoading || !this.plan || this.configRequired || this.unresolvedConflicts) return
      if (downloadOnly ? !this.canDownload : !this.canSync) return
      if ((downloadOnly ? this.downloadDeletes : this.syncDeletes) && !this.confirmDeletes) return
      this.updateStatus({
        planId: this.plan.id,
        action,
        resolutions: this.resolutions,
        confirmDeletes: this.confirmDeletes,
      })
    },
    openFailureReport(report) {
      this.failureReport = report
      if (!this.$refs.failureDialog.open) this.$refs.failureDialog.showModal()
    },
    notifyResult() {
      const complete = this.status.state === 'completed'
      const title = this.$t(this.statusLabel)
      const summary = this.$t(complete
        ? '已上传 {uploaded}，下载 {downloaded}，移除 {removed}，跳过 {skipped}。'
        : '已上传 {uploaded}，下载 {downloaded}，移除 {removed}，跳过 {skipped}，失败 {failed}。', this.counts)
      const report = {
        title,
        summary,
        failures: [...(this.status.failures || [])],
      }
      const openReport = () => this.openFailureReport(report)
      ElNotification({
        title,
        message: complete ? summary : () => h('div', [
          h('span', summary),
          h('button', {
            type: 'button',
            class: 'oss-sync-notice-details',
            onClick: event => {
              event.stopPropagation()
              openReport()
            },
          }, this.$t('查看失败文件')),
        ]),
        type: complete ? 'success' : 'warning',
        duration: 0,
        offset: 56,
        showClose: true,
        appendTo: this.$refs.notificationHost,
        customClass: complete ? 'oss-sync-notification' : 'oss-sync-notification oss-sync-notification--clickable',
        onClick: complete ? undefined : openReport,
      })
    },
    async updateStatus(payload) {
      window.clearTimeout(this.timer)
      this.request?.abort()
      const request = new AbortController()
      this.request = request
      if (payload) {
        this.starting = true
        this.connectionError = false
        this.planError = ''
      }
      try {
        const response = await fetch(endpoint, {
          method: payload ? 'POST' : 'GET',
          headers: payload ? { 'Content-Type': 'application/json' } : undefined,
          body: payload ? JSON.stringify(payload) : undefined,
          signal: request.signal,
          cache: 'no-store',
        })
        const status = await response.json()
        if (request.signal.aborted) return
        if (payload && !response.ok) {
          this.planError = status?.error || 'OSS_SYNC_PLAN_FAILED'
          this.plan = null
          return
        }
        if (!status?.state) throw new Error()
        if (payload || status.state === 'running') this.plan = null
        const wasRunning = this.status.state === 'running'
        this.status = status
        this.starting = false
        this.connectionError = false
        if ((payload || wasRunning) && (status.state === 'completed' || (status.state === 'failed' && !this.configRequired))) {
          this.notifyResult()
        }
      } catch {
        if (!request.signal.aborted) this.connectionError = true
      } finally {
        if (!request.signal.aborted) {
          this.starting = false
          this.request = null
          if (this.status.state === 'running' || (payload && this.connectionError)) {
            this.timer = window.setTimeout(() => this.updateStatus(), this.connectionError ? 2600 : 1000)
          }
        }
      }
    },
  },
}
</script>

<template>
  <button type="button" class="topbar-icon-button oss-sync-trigger"
    :class="{ 'is-running': running, 'has-count': showTopbarCount }"
    :aria-label="triggerLabel" :title="triggerLabel" aria-haspopup="dialog" @click="open">
    <span class="oss-sync-cloud" aria-hidden="true">
      <span v-if="running" class="oss-sync-ring" :class="{ 'is-scanning': !showTopbarCount }"
        :style="{ '--oss-sync-progress': (showTopbarCount ? percentage : 26) + '%' }"></span>
      <CloudUpload :size="19" />
    </span>
    <span v-if="showTopbarCount" class="oss-sync-topbar-count" aria-hidden="true">{{ counts.processed }}/{{ status.total }}</span>
  </button>
  <Teleport to="body">
    <dialog ref="dialog" class="dialog oss-sync-dialog oss-sync-plan-dialog" aria-labelledby="oss-sync-title">
      <header class="dialog-head">
        <h2 id="oss-sync-title">{{ $t('同步到 OSS') }}</h2>
        <button type="button" class="icon-button" :aria-label="$t('关闭')" @click="$refs.dialog.close()"><X :size="20" aria-hidden="true" /></button>
      </header>
      <div class="dialog-body oss-sync-body">
        <div class="oss-sync-status" :data-state="dialogState" role="status">
          <component :is="statusIcon" class="oss-sync-status-icon" :size="18" aria-hidden="true" />
          <strong>{{ $t(statusLabel) }}</strong>
        </div>
        <p v-if="target && !starting" class="oss-sync-note">{{ $t('目标') }} <code>{{ target }}</code></p>
        <p v-if="connectionError" class="project-config-error" role="status">{{ $t('暂时无法获取同步状态') }}</p>

        <template v-if="!running && plan">
          <p v-if="plan.revision" class="oss-sync-note">
            {{ $t('云端版本') }} <code :title="plan.revision">{{ plan.revision.slice(0, 8) }}</code>
          </p>
          <p v-if="plan.mode === 'migrate'" class="oss-sync-note">
            {{ $t('迁移会使用当前项目建立协作版本，原 OSS 备份将保留。') }}
          </p>
          <p v-if="plan.mode === 'migrate'" class="oss-sync-note">
            {{ $t('发现 {legacy} 个旧对象，其中 {reuse} 个可尝试校验后复用。', { legacy: plan.legacyCount, reuse: plan.legacyReuseCandidates }) }}
          </p>
          <p v-if="plan.mode === 'initialize'" class="oss-sync-note">
            {{ $t('发布后，同事可从 OSS 下载这个项目。') }}
          </p>
          <div v-if="planGroups.length" class="oss-sync-plan-groups">
            <details v-for="group in planGroups" :key="group.label" class="oss-sync-plan-group">
              <summary>
                <span>{{ $t(group.label) }}</span>
                <strong>{{ group.files.length }}</strong>
              </summary>
              <ul class="oss-sync-plan-files">
                <li v-for="entry in group.files" :key="entry.file">
                  <code>{{ entry.file }}</code>
                  <small v-if="Number.isFinite(entry.size)">{{ formatSize(entry.size) }}</small>
                </li>
              </ul>
            </details>
          </div>
          <section v-if="plan.conflicts?.length" class="oss-sync-conflicts" aria-labelledby="oss-conflicts-title">
            <h3 id="oss-conflicts-title">{{ $t('文件冲突（{count}）', { count: plan.conflicts.length }) }}</h3>
            <p class="oss-sync-note">{{ $t('请逐个选择。采用云端内容时，原本地文件会先备份。') }}</p>
            <ul class="oss-sync-conflict-files">
              <li v-for="conflict in plan.conflicts" :key="conflict.file">
                <code>{{ conflict.file }}</code>
                <ElRadioGroup :model-value="resolutions[conflict.file]" :aria-label="conflict.file"
                  @update:model-value="resolveConflict(conflict.file, $event)">
                  <ElRadioButton value="local">{{ $t(conflict.local ? '保留本地' : '保留本地删除') }}</ElRadioButton>
                  <ElRadioButton value="remote">{{ $t(conflict.remote ? '采用云端' : '采用云端删除') }}</ElRadioButton>
                </ElRadioGroup>
              </li>
            </ul>
          </section>
          <ElCheckbox v-if="deletionConfirmationVisible" v-model="confirmDeletes" class="oss-sync-delete-confirmation">
            {{ $t('确认移除本次操作中列出的文件') }}
          </ElCheckbox>
        </template>

        <template v-if="!starting && !plan && !planLoading && !planError && (status.total > 0 || status.state === 'completed')">
          <div class="oss-sync-progress">
            <span>{{ $t('已处理 {count} / {total} 个文件', { count: counts.processed, total: status.total }) }}</span>
            <strong>{{ percentage }}%</strong>
          </div>
          <ElProgress :percentage="percentage" :show-text="false" :stroke-width="8" :aria-label="$t('同步进度')" />
          <p v-if="status.currentFile" class="oss-sync-file">
            <code>{{ status.currentFile }}</code>
            <span v-if="status.currentPercent > 0">{{ status.currentPercent }}%</span>
          </p>
          <dl class="oss-sync-counts">
            <div v-for="item in resultStats" :key="item.label"><dt>{{ $t(item.label) }}</dt><dd>{{ item.count }}</dd></div>
          </dl>
        </template>

        <details v-if="!starting && !plan && !planLoading && !planError && status.failures?.length" class="oss-sync-failures">
          <summary>{{ $t('查看失败文件') }}</summary>
          <ul>
            <li v-for="failure in status.failures" :key="failure.file">
              <code>{{ failure.file }}</code>
              <small>{{ $t(fileErrors[failure.code] || '文件上传失败') }}</small>
            </li>
          </ul>
        </details>
      </div>
      <footer class="dialog-footer oss-sync-actions">
        <button v-if="!running && !configRequired" type="button" class="secondary oss-sync-refresh"
          :disabled="planLoading" @click="loadPlan">
          <RefreshCw :size="15" aria-hidden="true" /> {{ $t('重新预览') }}
        </button>
        <button type="button" class="secondary" @click="$refs.dialog.close()">{{ $t('关闭') }}</button>
        <button v-if="!running && configRequired" type="button" class="primary" @click="openStorage">{{ $t('存储设置') }}</button>
        <button v-if="!running && canDownload" type="button" :class="canSync ? 'secondary' : 'primary'"
          :disabled="unresolvedConflicts > 0 || (downloadDeletes && !confirmDeletes)" @click="start('download')">
          <CloudDownload :size="16" aria-hidden="true" /> {{ $t(plan.mode === 'download' ? '下载项目' : '仅下载更新') }}
        </button>
        <button v-if="!running && canSync" type="button" class="primary"
          :disabled="unresolvedConflicts > 0 || (syncDeletes && !confirmDeletes)" @click="start('sync')">
          {{ $t(syncActionLabel) }}
        </button>
      </footer>
    </dialog>
    <dialog ref="failureDialog" class="dialog oss-sync-dialog" aria-labelledby="oss-sync-failure-title">
      <header class="dialog-head">
        <h2 id="oss-sync-failure-title">{{ $t('同步失败详情') }}</h2>
        <button type="button" class="icon-button" :aria-label="$t('关闭')" @click="$refs.failureDialog.close()"><X :size="20" aria-hidden="true" /></button>
      </header>
      <div v-if="failureReport" class="dialog-body oss-sync-body">
        <div class="oss-sync-status" data-state="failed">
          <CircleAlert :size="18" aria-hidden="true" />
          <strong>{{ failureReport.title }}</strong>
        </div>
        <p class="oss-sync-note">{{ failureReport.summary }}</p>
        <ul v-if="failureReport.failures.length" class="oss-sync-failure-list">
          <li v-for="failure in failureReport.failures" :key="failure.file">
            <code>{{ failure.file }}</code>
            <small>
              {{ $t(fileErrors[failure.code] || '文件上传失败') }}
              <span v-if="failure.status">(HTTP {{ failure.status }})</span>
            </small>
          </li>
        </ul>
      </div>
      <footer class="dialog-footer">
        <button type="button" class="secondary" @click="$refs.failureDialog.close()">{{ $t('关闭') }}</button>
      </footer>
    </dialog>
  </Teleport>
  <Teleport :to="notificationTarget">
    <div ref="notificationHost"></div>
  </Teleport>
</template>
