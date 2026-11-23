import { randomUUID } from 'node:crypto'
import { assertPortablePaths, createRemoteStore, validateManifest } from './oss-collab-remote.js'
import { withLocalProject } from './oss-collab-local.js'

export function collabError(code) {
  return Object.assign(new Error(code), { code })
}

const asMap = files => new Map(Object.entries(files || {}))
const same = (a, b) => a?.hash === b?.hash && a?.size === b?.size
const targetName = destination => [destination.bucket, destination.prefix].filter(Boolean).join('/')
const destinationId = destination => JSON.stringify([destination.endpoint, destination.bucket, destination.prefix])
const isIgnoreFile = file => file === '.gitignore' || file.endsWith('/.gitignore')

function baselineOf(value) {
  try {
    return value ? validateManifest(value) : null
  } catch {
    throw collabError('OSS_SYNC_BASELINE_INVALID')
  }
}

function classify(base, local, remote, paths) {
  const upload = []
  const download = []
  const removeLocal = []
  const removeRemote = []
  const conflicts = []
  const baseline = asMap(base?.files)
  const cloud = asMap(remote?.files)
  for (const file of paths) {
    const l = local.get(file)
    const r = cloud.get(file)
    const b = baseline.get(file)
    if (same(l, r)) continue
    if (!remote) {
      if (l) upload.push({ file, size: l.size })
    } else if (!base) {
      if (!l) download.push({ file, size: r.size })
      else if (r) conflicts.push({ file, local: l, remote: r })
    } else if (same(l, b)) {
      if (r) download.push({ file, size: r.size })
      else removeLocal.push({ file })
    } else if (same(r, b)) {
      if (l) upload.push({ file, size: l.size })
      else removeRemote.push({ file })
    } else {
      conflicts.push({ file, local: l || null, remote: r || null })
    }
  }
  return { upload, download, removeLocal, removeRemote, conflicts }
}

export async function planProject({ root, client, destination, signal, requireRemote = false }) {
  const store = createRemoteStore(client, destination)
  return withLocalProject(root, signal, async workspace => {
    const head = await store.readHead()
    if (requireRemote && !head.manifest) throw collabError('OSS_COLLAB_NO_PUBLISHED_VERSION')
    const localBaseline = await workspace.readBaseline()
    const localFiles = await workspace.scan()
    const base = baselineOf(localBaseline)
    if (base && head.manifest?.projectId !== base.projectId) throw collabError('OSS_COLLAB_PROJECT_MISMATCH')
    const local = asMap(localFiles)
    const candidates = [...new Set([...local.keys(), ...Object.keys(base?.files || {}), ...Object.keys(head.manifest?.files || {})])].sort()
    const eligible = await workspace.filterFiles(candidates)
    try {
      assertPortablePaths(eligible.filter(file => local.has(file) || Object.hasOwn(head.manifest?.files || {}, file)))
    } catch {
      throw collabError('OSS_COLLAB_PATH_COLLISION')
    }
    const changes = classify(base, local, head.manifest, eligible)
    const legacy = head.manifest ? new Map() : await store.listLegacy()
    if (legacy.size && !local.size) throw collabError('OSS_COLLAB_LEGACY_LOCAL_REQUIRED')
    if (!head.manifest && !local.size) throw collabError('OSS_COLLAB_EMPTY_PROJECT')
    const changed = Object.values(changes).some(entries => entries.length)
    const mode = !head.manifest
      ? (legacy.size ? 'migrate' : 'initialize')
      : !base ? 'download' : changed || base.revision !== head.manifest.revision ? 'sync' : 'noop'
    return {
      id: randomUUID(),
      target: targetName(destination),
      revision: head.manifest?.revision || null,
      mode,
      ...changes,
      legacyCount: legacy.size,
      legacyReuseCandidates: changes.upload.filter(({ file, size }) => legacy.get(file)?.size === size).length,
      baseRevision: base?.revision || null,
      createdAt: Date.now(),
      destinationId: destinationId(destination),
      eligible,
      local,
      head,
      legacy,
    }
  })
}

export function planPreview(plan) {
  const { id, target, revision, mode, upload, download, removeLocal, removeRemote, conflicts, legacyCount, legacyReuseCandidates, baseRevision } = plan
  return { id, target, revision, mode, upload, download, removeLocal, removeRemote, conflicts, legacyCount, legacyReuseCandidates, baseRevision }
}

export function selectChanges(plan, { action, resolutions, confirmDeletes }) {
  if (!['sync', 'download'].includes(action) || plan.mode === 'noop' ||
    (action === 'download' && !plan.head.manifest) || (action === 'sync' && plan.mode === 'download')) {
    throw collabError('OSS_COLLAB_PREVIEW_STALE')
  }
  const uploads = action === 'sync' ? [...plan.upload] : []
  const removesRemote = action === 'sync' ? [...plan.removeRemote] : []
  const downloads = [...plan.download]
  const removesLocal = [...plan.removeLocal]
  for (const { file, local, remote } of plan.conflicts) {
    const choice = Object.hasOwn(resolutions, file) ? resolutions[file] : undefined
    if (choice === 'remote') {
      if (remote) downloads.push({ file, size: remote.size, backup: true })
      else removesLocal.push({ file })
    } else if (choice === 'local') {
      if (action !== 'sync') continue
      if (local) uploads.push({ file, size: local.size })
      else removesRemote.push({ file })
    } else {
      throw collabError('OSS_COLLAB_RESOLUTION_REQUIRED')
    }
  }
  if ((removesLocal.length || removesRemote.length) && !confirmDeletes) {
    throw collabError('OSS_COLLAB_DELETE_CONFIRMATION_REQUIRED')
  }
  return { downloads, uploads, removesLocal, removesRemote }
}

function validateCurrentPlan(plan, head, local, baseline, eligible, destination) {
  if (plan.destinationId !== destinationId(destination) || plan.head.position !== head.position ||
    plan.revision !== (head.manifest?.revision || null) || plan.baseRevision !== (baseline?.revision || null) ||
    local.size !== plan.local.size || [...local].some(([file, entry]) => !same(entry, plan.local.get(file))) ||
    eligible.length !== plan.eligible.length || eligible.some((file, index) => file !== plan.eligible[index])) {
    throw collabError('OSS_COLLAB_PREVIEW_STALE')
  }
}

export async function applyProject({ root, client, destination, plan, action, changes, signal, onProgress }) {
  const remote = createRemoteStore(client, destination)
  return withLocalProject(root, signal, async workspace => {
    const job = {
      phase: 'scanning', total: 0, uploaded: 0, downloaded: 0, removed: 0, skipped: 0, failed: 0,
      currentFile: '', currentPercent: 0, failures: [],
    }
    const emit = () => {
      const snapshot = { ...job, failures: [...job.failures] }
      onProgress?.(snapshot)
      return snapshot
    }
    function checkStopped() {
      if (signal?.aborted) throw collabError('OSS_SYNC_STOPPED')
    }
    async function processFile(phase, file, handler) {
      checkStopped()
      job.phase = phase
      job.currentFile = file
      job.currentPercent = 0
      emit()
      try {
        const result = await handler()
        job[result]++
      } catch (error) {
        checkStopped()
        if (error?.code === 'OSS_SYNC_STATE_FAILED') throw error
        const code = typeof error?.code === 'string' && /^(OSS_SYNC_|OSS_COLLAB_)[A-Z_]{1,70}$/.test(error.code)
          ? error.code : phase === 'downloading' ? 'OSS_SYNC_DOWNLOAD_FAILED' : 'OSS_SYNC_UPLOAD_FAILED'
        const status = error?.status >= 400 && error.status <= 599 ? Number(error.status) : undefined
        job.failures.push({ file, code, status })
        job.failed++
      }
      job.currentFile = ''
      job.currentPercent = 0
      emit()
    }

    emit()
    const head = await remote.readHead()
    const baseValue = await workspace.readBaseline()
    const localFiles = await workspace.scan()
    const local = asMap(localFiles)
    const base = baselineOf(baseValue)
    const eligible = await workspace.filterFiles(plan.eligible)
    validateCurrentPlan(plan, head, local, base, eligible, destination)
    if (!head.manifest && plan.mode === 'initialize' && (await remote.listLegacy()).size) throw collabError('OSS_COLLAB_PREVIEW_STALE')

    const { uploads, downloads, removesLocal, removesRemote } = changes
    const cloud = asMap(head.manifest?.files)
    const next = new Map(cloud)
    for (const { file } of uploads) next.set(file, local.get(file))
    for (const { file } of removesRemote) next.delete(file)
    // Validate the complete manifest before applying filesystem changes.
    const manifest = action === 'sync' && (!head.manifest || uploads.length || removesRemote.length) ? validateManifest({
      projectId: head.manifest?.projectId || randomUUID(),
      revision: randomUUID(),
      parent: head.manifest?.revision || null,
      createdAt: new Date().toISOString(),
      files: Object.fromEntries([...next].sort(([a], [b]) => a.localeCompare(b))),
    }) : null

    const operations = new Set([...uploads, ...downloads, ...removesLocal, ...removesRemote].map(item => item.file))
    const conflicts = new Set(plan.conflicts.map(item => item.file))
    job.skipped = eligible.filter(file => !operations.has(file) && !conflicts.has(file) && local.has(file) && same(local.get(file), cloud.get(file))).length
    job.total = job.skipped + uploads.length + downloads.length + removesLocal.length + removesRemote.length
    emit()

    const incoming = [
      ...removesLocal.map(change => ({ ...change, remove: true })),
      ...downloads,
    ]
    async function applyIncoming(change) {
      const { file, backup, remove } = change
      await processFile('downloading', file, async () => {
        if (remove) {
          await workspace.remove({ file, expected: local.get(file) })
          return 'removed'
        }
        await workspace.download({ file, entry: cloud.get(file), expected: local.get(file) || null, remote, backup })
        return 'downloaded'
      })
    }
    const incomingRules = incoming.filter(({ file }) => isIgnoreFile(file))
    for (const change of incomingRules) await applyIncoming(change)
    if (job.failed) return emit()

    const remaining = incoming.filter(({ file }) => !isIgnoreFile(file))
    const stillEligible = incomingRules.length
      ? new Set(await workspace.filterFiles(remaining.map(({ file }) => file)))
      : null
    for (const change of remaining) {
      if (stillEligible && !stillEligible.has(change.file)) {
        job.skipped++
        emit()
      } else {
        await applyIncoming(change)
      }
    }
    if (job.failed) return emit()

    // Once cloud changes are applied, record that baseline even if a later upload needs a retry.
    if (head.manifest && base?.revision !== head.manifest.revision) await workspace.writeBaseline(head.manifest)
    if (!manifest) return emit()
    const outgoing = [...uploads, ...removesRemote].map(({ file }) => file)
    if ((await workspace.filterFiles(outgoing)).length !== outgoing.length) throw collabError('OSS_COLLAB_PREVIEW_STALE')

    for (const { file } of uploads) {
      const entry = local.get(file)
      await processFile('uploading', file, async () => {
        if (plan.legacy.get(file)?.size === entry.size && await remote.reuseLegacy(file, entry.hash, entry.size, signal)) {
          return 'skipped'
        }
        return await workspace.upload({
          file, entry, remote, onProgress(percent) {
            job.currentPercent = percent
            emit()
          },
        })
      })
    }
    if (job.failed) return emit()
    checkStopped()
    job.phase = 'publishing'
    emit()
    await remote.publish(manifest, head)
    await workspace.writeBaseline(manifest)
    job.removed += removesRemote.length
    return emit()
  })
}
