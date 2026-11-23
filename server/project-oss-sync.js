import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot } from './project-paths.js'
import { openProjectStorage } from './project-storage.js'
import { applyProject, planPreview, planProject, selectChanges } from './oss-collab-plan.js'

const stateFile = join(projectRoot, '.kacha', 'oss-sync', 'job.json')
const idle = {
  state: 'idle',
  phase: null,
  total: 0,
  uploaded: 0,
  downloaded: 0,
  removed: 0,
  skipped: 0,
  failed: 0,
  currentFile: '',
  currentPercent: 0,
  failures: [],
}
const knownErrors = new Set([
  'OSS_NOT_CONFIGURED',
  'OSS_INVALID_CONFIG',
  'OSS_SYNC_BUSY',
  'OSS_SYNC_SCAN_FAILED',
  'OSS_SYNC_STATE_FAILED',
  'OSS_SYNC_STOPPED',
  'OSS_SYNC_BASELINE_INVALID',
  'OSS_COLLAB_PREVIEW_STALE',
  'OSS_COLLAB_RESOLUTION_REQUIRED',
  'OSS_COLLAB_DELETE_CONFIRMATION_REQUIRED',
  'OSS_COLLAB_REMOTE_CHANGED',
  'OSS_COLLAB_REMOTE_INVALID',
  'OSS_COLLAB_REMOTE_IO',
  'OSS_COLLAB_PROJECT_MISMATCH',
  'OSS_COLLAB_LEGACY_LOCAL_REQUIRED',
  'OSS_COLLAB_EMPTY_PROJECT',
  'OSS_COLLAB_PATH_COLLISION',
  'OSS_SYNC_FILE_CHANGED',
  'OSS_SYNC_FILE_UNREADABLE',
])

async function readLastJob() {
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8'))
    if (!['running', 'completed', 'failed', 'interrupted'].includes(saved.state)) return idle
    if (saved.state !== 'running') return saved
    return { ...saved, state: 'interrupted', currentFile: '', currentPercent: 0 }
  } catch {
    return idle
  }
}

async function writeLastJob(job) {
  const temp = stateFile + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, JSON.stringify(job) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temp, stateFile)
  } finally {
    await rm(temp, { force: true })
  }
}

function sendJSON(res, status, data = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

function allowedOrigin(req) {
  return !req.headers.origin || req.headers.origin === 'http://' + req.headers.host
}

function errorCode(error) {
  return knownErrors.has(error?.code) ? error.code : 'OSS_SYNC_FAILED'
}

async function readConfirmation(req) {
  let body = ''
  req.setEncoding('utf8')
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    body += chunk
    if (body.length > 1024 * 1024) {
      req.resume()
      throw new Error()
    }
  }
  const fields = JSON.parse(body)
  if (typeof fields?.planId !== 'string' || !['sync', 'download'].includes(fields.action) ||
    !fields.resolutions || typeof fields.resolutions !== 'object' || Array.isArray(fields.resolutions) ||
    typeof fields.confirmDeletes !== 'boolean') throw new Error()
  return fields
}

export function projectOssSync() {
  let job
  let controller
  let lastSavedAt = 0
  let pendingWrite = Promise.resolve()
  const initial = readLastJob()
  const plans = new Map()
  let pendingPreview

  function remember() {
    const snapshot = job
    lastSavedAt = Date.now()
    // The engine persists the upload ledger separately. This record is only for the progress UI.
    pendingWrite = pendingWrite.then(() => writeLastJob(snapshot)).catch(() => {})
  }

  async function run(plan, action, changes, signal) {
    let ownsLedger = false
    try {
      const { client, destination } = await openProjectStorage({ timeout: 120000 })
      job = { ...job, target: [destination.bucket, destination.prefix].filter(Boolean).join('/') }
      const progress = await applyProject({
        root: projectRoot,
        client,
        destination,
        plan,
        action,
        changes,
        signal,
        onProgress(next) {
          ownsLedger = true
          job = { ...job, ...next }
          if (Date.now() - lastSavedAt >= 1000) remember()
        },
      })
      job = { ...job, ...progress, state: progress.failed ? 'failed' : 'completed' }
    } catch (error) {
      const code = errorCode(error)
      job = { ...job, state: signal.aborted ? 'interrupted' : 'failed', error: code }
    } finally {
      job = { ...job, currentFile: '', currentPercent: 0, finishedAt: new Date().toISOString() }
      if (ownsLedger) remember()
      controller = null
    }
  }

  return {
    name: 'workbench-project-oss-sync',
    configureServer(server) {
      server.httpServer?.once('close', () => controller?.abort())
      server.middlewares.use('/api/project-oss-sync/plan', async (req, res) => {
        if (!allowedOrigin(req)) return sendJSON(res, 403)
        if (req.method !== 'GET') return sendJSON(res, 405)
        if (job?.state === 'running') return sendJSON(res, 409, { error: 'OSS_SYNC_BUSY' })
        try {
          if (!pendingPreview) {
            pendingPreview = openProjectStorage({ timeout: 120000 }).then(storage => planProject({
              root: projectRoot,
              ...storage,
            })).then(plan => {
              plans.set(plan.id, plan)
              if (plans.size > 8) plans.delete(plans.keys().next().value)
              return planPreview(plan)
            }).finally(() => { pendingPreview = null })
          }
          return sendJSON(res, 200, await pendingPreview)
        } catch (error) {
          return sendJSON(res, 409, { error: errorCode(error) })
        }
      })
      server.middlewares.use('/api/project-oss-sync', async (req, res) => {
        if (!allowedOrigin(req)) return sendJSON(res, 403)
        if (req.method === 'GET') return sendJSON(res, 200, job || await initial)
        if (req.method !== 'POST') return sendJSON(res, 405)
        if (req.headers['content-type'] !== 'application/json') return sendJSON(res, 415)
        let confirmation
        try {
          confirmation = await readConfirmation(req)
        } catch {
          return sendJSON(res, 400, { error: 'OSS_COLLAB_PREVIEW_STALE' })
        }
        if (job?.state === 'running') return sendJSON(res, 409, { error: 'OSS_SYNC_BUSY' })
        const plan = plans.get(confirmation.planId)
        if (!plan || Date.now() - plan.createdAt > 15 * 60 * 1000) {
          return sendJSON(res, 409, { error: 'OSS_COLLAB_PREVIEW_STALE' })
        }
        let changes
        try {
          changes = selectChanges(plan, confirmation)
        } catch (error) {
          return sendJSON(res, 409, { error: errorCode(error) })
        }

        plans.clear()
        controller = new AbortController()
        lastSavedAt = 0
        const { action } = confirmation
        job = { ...idle, state: 'running', action, phase: 'scanning', target: plan.target, startedAt: new Date().toISOString() }
        void run(plan, action, changes, controller.signal)
        return sendJSON(res, 200, job)
      })
    },
  }
}
