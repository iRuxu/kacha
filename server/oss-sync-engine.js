import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { devNull } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const multipartThreshold = 32 * 1024 * 1024
const partSize = 8 * 1024 * 1024
const excludedNames = ['.git', '.kacha', 'node_modules', '.env', '.env.*']
const sha256 = input => createHash('sha256').update(input).digest('hex')

function syncError(code) {
  return Object.assign(new Error(code), { code })
}

function checkStopped(signal) {
  if (signal?.aborted) throw syncError('OSS_SYNC_STOPPED')
}

function isExcluded(name) {
  const lower = name.toLowerCase()
  return lower === '.git' || lower === '.kacha' || lower === 'node_modules' || lower === '.env' || lower.startsWith('.env.')
}

function isSafeFile(file) {
  return file.split('/').every(part => part && part !== '.' && part !== '..' && !isExcluded(part))
}

async function ensureDirectory(directory) {
  await mkdir(directory, { mode: 0o700 }).catch(error => {
    if (error.code !== 'EEXIST') throw error
  })
  if (!(await lstat(directory)).isDirectory()) throw syncError('OSS_SYNC_STATE_FAILED')
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function writeRecord(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temp, file)
  } catch {
    throw syncError('OSS_SYNC_STATE_FAILED')
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

async function reclaimLock(directory, lock, owner, candidate) {
  const claims = []
  let stale = owner
  for (let attempt = 0; attempt < 32; attempt++) {
    if (processIsAlive(stale.pid) || !/^[a-f0-9-]{36}$/.test(stale.token)) throw syncError('OSS_SYNC_BUSY')
    const claim = join(directory, 'reclaim-' + stale.token)
    try {
      await link(candidate, claim)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      stale = await readJson(claim)
      if (!stale) return
      claims.push(claim)
      continue
    }

    try {
      if ((await readJson(lock))?.token === owner.token) await rm(lock, { force: true })
    } finally {
      await Promise.all([...claims, claim].map(file => rm(file, { force: true })))
    }
    return
  }
  throw syncError('OSS_SYNC_BUSY')
}

async function acquireLock(directory) {
  const lock = join(directory, 'engine.lock')
  const token = randomUUID()
  const candidate = join(directory, 'lock-' + token)
  await writeFile(candidate, JSON.stringify({ pid: process.pid, token }), { mode: 0o600, flag: 'wx' })
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await link(candidate, lock)
        return async () => {
          if ((await readJson(lock))?.token === token) await rm(lock, { force: true })
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const owner = await readJson(lock)
        if (!owner) continue
        // Each immutable claim identifies its process. Another process can
        // continue reclamation if the claimant itself was interrupted.
        await reclaimLock(directory, lock, owner, candidate)
      }
    }
    throw syncError('OSS_SYNC_BUSY')
  } finally {
    await rm(candidate, { force: true })
  }
}

function runGit(root, args, { input, allowNoMatches = false, signal } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = devNull
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: root, env, encoding: 'buffer', signal, maxBuffer: 64 * 1024 * 1024 },
      (error, output) => {
        if (error && !(allowNoMatches && error.code === 1)) reject(error)
        else resolve(output)
      })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

async function listNestedFiles(root, directory, signal) {
  const files = []
  const pending = [directory]
  while (pending.length) {
    checkStopped(signal)
    const relative = pending.pop()
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (isExcluded(entry.name)) continue
      const file = relative + '/' + entry.name
      if (entry.isDirectory()) pending.push(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  return files
}

async function gitWorkTree(root, scratch, signal) {
  const gitDirectory = join(scratch, 'git')
  await runGit(root, ['init', '--bare', '--quiet', '--template=', gitDirectory], { signal })
  return ['--git-dir=' + gitDirectory, '--work-tree=' + root, '-c', 'core.precomposeUnicode=false']
}

async function filterProjectFiles(root, scratch, files, signal, context) {
  if (!files.length) return []
  context ??= await gitWorkTree(root, scratch, signal)
  const ignored = await runGit(root, [...context, 'check-ignore', '--no-index', '--stdin', '-z'], {
    input: files.join('\0') + '\0', allowNoMatches: true, signal,
  })
  const omitted = new Set(ignored.toString('utf8').split('\0'))
  return files.filter(file => !omitted.has(file))
}

async function scanProject(root, scratch, signal) {
  try {
    const context = await gitWorkTree(root, scratch, signal)
    const output = await runGit(root, [
      ...context, 'ls-files', '--others', '--exclude-per-directory=.gitignore',
      ...excludedNames.map(name => '--exclude=' + name), '-z',
    ], { signal })

    const files = []
    const nestedFiles = []
    for (const entry of output.toString('utf8').split('\0')) {
      const relative = entry.endsWith('/') ? entry.slice(0, -1) : entry
      if (!isSafeFile(relative)) continue
      if (entry.endsWith('/')) nestedFiles.push(...await listNestedFiles(root, relative, signal))
      else files.push(relative)
    }
    files.push(...await filterProjectFiles(root, scratch, nestedFiles, signal, context))
    const regular = []
    for (const file of files) {
      checkStopped(signal)
      const localFile = join(root, file)
      const info = await lstat(localFile).catch(error => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      if (info?.isFile()) regular.push({ file, size: info.size })
    }
    return regular
  } catch {
    checkStopped(signal)
    throw syncError('OSS_SYNC_SCAN_FAILED')
  }
}

function sameFile(a, b) {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

async function checkSource(file, previous) {
  if (await realpath(dirname(file)) !== dirname(file) || !sameFile(previous, await lstat(file, { bigint: true }))) {
    throw syncError('OSS_SYNC_FILE_CHANGED')
  }
}

async function fingerprint(source, size, signal) {
  const hash = createHash('sha256')
  if (size > 0) {
    for await (const chunk of source.createReadStream({ autoClose: false, start: 0, end: size - 1, signal })) {
      hash.update(chunk)
    }
  }
  checkStopped(signal)
  return hash.digest('hex')
}

async function createSnapshot(source, size, snapshot, signal) {
  const hash = createHash('sha256')
  if (!size) {
    await writeFile(snapshot, '', { mode: 0o600, flag: 'wx' })
    return hash.digest('hex')
  }
  const trackHash = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    source.createReadStream({ autoClose: false, start: 0, end: size - 1 }),
    trackHash,
    createWriteStream(snapshot, { mode: 0o600, flags: 'wx' }),
    { signal },
  )
  return hash.digest('hex')
}

async function readRecord(file) {
  try {
    return await readJson(file)
  } catch {
    throw syncError('OSS_SYNC_STATE_FAILED')
  }
}

function expiredCheckpoint(error) {
  return error.name === 'abort' || error.code === 'NoSuchUpload' || error.status === 404
}

async function uploadFile({ client, file, key, snapshot, size, fingerprint, checkpoint, recordFile, signal, progress }) {
  if (size < multipartThreshold) {
    await client.put(key, snapshot)
    return
  }
  const options = {
    partSize,
    parallel: 1,
    async progress(fraction, current) {
      if (current) {
        const { file: _snapshot, ...state } = current
        await writeRecord(recordFile, { file, fingerprint, checkpoint: state })
      }
      progress(Math.round(fraction * 100))
      checkStopped(signal)
    },
  }
  if (checkpoint?.name === key && checkpoint.fileSize === size && checkpoint.uploadId) {
    options.checkpoint = { ...checkpoint, file: snapshot }
    try {
      await client.multipartUpload(key, snapshot, options)
      return
    } catch (error) {
      if (!expiredCheckpoint(error)) throw error
      checkStopped(signal)
      await writeRecord(recordFile, { file, fingerprint })
      delete options.checkpoint
    }
  }
  await client.multipartUpload(key, snapshot, options)
}

async function syncFile({ client, root, file, key, scratch, recordFile, signal, progress }) {
  const localFile = join(root, file)
  let snapshot
  let source
  let stage = 'read'
  try {
    if (await realpath(dirname(localFile)) !== dirname(localFile)) throw syncError('OSS_SYNC_FILE_CHANGED')
    source = await open(localFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = await source.stat({ bigint: true })
    if (!info.isFile()) throw syncError('OSS_SYNC_FILE_CHANGED')
    const size = Number(info.size)
    const digest = await fingerprint(source, size, signal)
    await checkSource(localFile, info)
    const record = await readRecord(recordFile)
    if (record?.completed === digest) return 'skipped'
    snapshot = join(scratch, 'upload-' + randomUUID() + extname(file))
    const copied = await createSnapshot(source, size, snapshot, signal)
    await checkSource(localFile, info)
    if (copied !== digest) throw syncError('OSS_SYNC_FILE_CHANGED')
    await source.close()
    source = null
    checkStopped(signal)

    stage = 'upload'
    await uploadFile({
      client, file, key, snapshot, size, fingerprint: digest, recordFile, signal, progress,
      checkpoint: record?.fingerprint === digest ? record.checkpoint : null,
    })
    await writeRecord(recordFile, { file, completed: digest })
    stage = 'read'
    await checkSource(localFile, info)
    return 'uploaded'
  } catch (error) {
    checkStopped(signal)
    if (error.code === 'OSS_SYNC_STATE_FAILED') throw error
    if (error.code === 'OSS_SYNC_FILE_CHANGED' || (stage === 'read' && ['ENOENT', 'ELOOP'].includes(error.code))) {
      return { code: 'OSS_SYNC_FILE_CHANGED' }
    }
    if (stage === 'read') return { code: 'OSS_SYNC_FILE_UNREADABLE' }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined
    return { code: 'OSS_SYNC_UPLOAD_FAILED', status }
  } finally {
    if (source) await source.close().catch(() => {})
    if (snapshot) await rm(snapshot, { force: true }).catch(() => {})
  }
}

async function withSyncWorkspace(root, signal, run) {
  let release
  let scratch
  try {
    root = await realpath(root)
    const cache = join(root, '.kacha')
    const state = join(cache, 'oss-sync')
    await ensureDirectory(cache)
    await ensureDirectory(state)
    release = await acquireLock(state)
    checkStopped(signal)
    for (const entry of await readdir(state, { withFileTypes: true })) {
      if (entry.isDirectory() && /^work-[a-z0-9]{6}$/i.test(entry.name)) {
        await rm(join(state, entry.name), { recursive: true })
      }
    }
    scratch = await mkdtemp(join(state, 'work-'))
    return await run({ root, state, scratch })
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {})
    if (release) await release().catch(() => {})
  }
}

export async function syncProject({ root: projectRoot, client, destination, onProgress, signal }) {
  try {
    return await withSyncWorkspace(projectRoot, signal, async ({ root, state, scratch }) => {
      const job = {
        phase: 'scanning', total: 0, uploaded: 0, skipped: 0, failed: 0,
        currentFile: '', currentPercent: 0, totalBytes: 0, processedBytes: 0, failures: [],
      }
      const emit = () => {
        const value = { ...job, failures: [...job.failures] }
        onProgress?.(value)
        return value
      }
      emit()
      checkStopped(signal)

      const prefix = (destination.prefix || '').replace(/^\/+|\/+$/g, '')
      const records = join(state, sha256(JSON.stringify([destination.endpoint, destination.bucket, prefix])))
      await ensureDirectory(records)
      const files = await scanProject(root, scratch, signal)
      job.total = files.length
      job.totalBytes = files.reduce((total, entry) => total + entry.size, 0)
      job.phase = 'uploading'
      emit()

      for (const { file, size } of files) {
        checkStopped(signal)
        job.currentFile = file
        job.currentPercent = 0
        emit()
        const result = await syncFile({
          client, root, file, key: prefix ? prefix + '/' + file : file, scratch, signal,
          recordFile: join(records, sha256(file) + '.json'),
          progress(percent) {
            job.currentPercent = percent
            emit()
          },
        })
        if (typeof result === 'string') {
          job[result]++
        } else {
          job.failed++
          job.failures.push({ file, ...result })
        }
        job.processedBytes += size
        job.currentFile = ''
        job.currentPercent = 0
        emit()
      }

      return emit()
    })
  } catch (error) {
    checkStopped(signal)
    if (['OSS_SYNC_BUSY', 'OSS_SYNC_SCAN_FAILED', 'OSS_SYNC_STATE_FAILED'].includes(error.code)) throw error
    throw syncError('OSS_SYNC_STATE_FAILED')
  }
}

export {
  checkSource,
  checkStopped,
  createSnapshot,
  ensureDirectory,
  filterProjectFiles,
  fingerprint,
  readRecord,
  sameFile,
  scanProject,
  syncError,
  uploadFile,
  withSyncWorkspace,
  writeRecord,
}
