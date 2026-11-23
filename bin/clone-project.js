import { applyProject, planProject, selectChanges } from '../server/oss-collab-plan.js'
import { openProjectStorage } from '../server/project-storage.js'

const messages = {
  OSS_NOT_CONFIGURED: 'Set OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET in the target directory’s .env.',
  OSS_INVALID_CONFIG: 'Check the OSS settings in the target directory’s .env.',
  OSS_COLLAB_NO_PUBLISHED_VERSION: 'No collaboration version has been published to the configured OSS path.',
  OSS_COLLAB_REMOTE_CHANGED: 'A newer version was published during the download. Run kacha clone again.',
  OSS_COLLAB_PREVIEW_STALE: 'The local files or cloud version changed. Run kacha clone again.',
  OSS_COLLAB_PROJECT_MISMATCH: 'The target directory belongs to a different OSS project.',
  OSS_COLLAB_REMOTE_INVALID: 'The cloud project manifest is invalid.',
  OSS_COLLAB_REMOTE_IO: 'Unable to read the cloud project. Check the OSS settings, permissions and network.',
  OSS_COLLAB_PATH_COLLISION: 'Local and cloud paths collide. Use an empty directory or rename the affected files.',
  OSS_SYNC_BUSY: 'Another Kacha process is using the target directory.',
  OSS_SYNC_SCAN_FAILED: 'Unable to scan the target directory. Make sure Git is installed and the files are readable.',
  OSS_SYNC_BASELINE_INVALID: 'The target directory has an invalid config/oss-sync.json.',
  OSS_SYNC_STATE_FAILED: 'Unable to save the download state. Check free space and directory permissions.',
  OSS_SYNC_FILE_CHANGED: 'A local file changed during the download. Check the target directory and retry.',
  OSS_CLONE_EXISTING_PROJECT: 'This directory already has a project. Clone legacy OSS versions into a new directory. For Git LFS projects, use git pull.',
}

export async function cloneProject(root) {
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  let progressVisible = false
  let lastProgress = 0

  function clearProgress() {
    if (!progressVisible) return
    process.stdout.clearLine(0)
    process.stdout.cursorTo(0)
    progressVisible = false
  }

  try {
    const { client, destination } = await openProjectStorage({ root, timeout: 120000 })
    console.log('Reading the latest project version from OSS…')
    const plan = await planProject({ root, client, destination, signal: controller.signal, requireRemote: true })
    if (plan.baseRevision) throw Object.assign(new Error(), { code: 'OSS_CLONE_EXISTING_PROJECT' })

    const unexpected = [...plan.local.keys()].filter(file => !Object.hasOwn(plan.head.manifest.files, file))
    const conflicts = [...new Set([...plan.conflicts.map(({ file }) => file), ...unexpected])]
    if (conflicts.length) {
      console.error('The target directory contains files that differ from the cloud project. Use an empty directory or move these files first:')
      for (const file of conflicts.slice(0, 20)) console.error('  ' + file)
      if (conflicts.length > 20) console.error('  … and ' + (conflicts.length - 20) + ' more')
      return 1
    }

    const action = 'download'
    const changes = selectChanges(plan, { action, resolutions: {}, confirmDeletes: false })
    console.log('Downloading version ' + plan.revision + ' (' + plan.download.length + ' files to download)…')
    const result = await applyProject({
      root, client, destination, plan, action, changes, signal: controller.signal,
      onProgress(progress) {
        if (!process.stdout.isTTY || !progress.total || Date.now() - lastProgress < 120) return
        clearProgress()
        process.stdout.write('Processed ' + (progress.downloaded + progress.skipped + progress.failed) + '/' + progress.total + ' files')
        progressVisible = true
        lastProgress = Date.now()
      },
    })
    clearProgress()
    if (result.failed) {
      console.error(result.failed + ' files could not be downloaded. Run kacha clone again to retry.')
      for (const { file, code, status } of result.failures.slice(0, 20)) {
        console.error('  ' + file + ' (' + code + (status ? ', HTTP ' + status : '') + ')')
      }
      if (result.failed > 20) console.error('  … and ' + (result.failed - 20) + ' more')
      return 1
    }
    console.log('Downloaded ' + result.downloaded + ' files, skipped ' + result.skipped + '. Project ready in ' + root)
    return 0
  } catch (error) {
    clearProgress()
    if (controller.signal.aborted || error?.code === 'OSS_SYNC_STOPPED') {
      console.error('Download interrupted. Run kacha clone again to continue.')
      return 130
    }
    const code = error?.code
    const message = Object.hasOwn(messages, code) ? messages[code] : 'Unable to clone the project from OSS.'
    console.error('kacha clone: ' + message)
    return 1
  } finally {
    process.off('SIGINT', stop)
  }
}
