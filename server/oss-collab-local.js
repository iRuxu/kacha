import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { chmod, link, lstat, mkdir, mkdtemp, open, rename, rm, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isProjectFile } from './oss-collab-remote.js'
import {
  checkSource, checkStopped, createSnapshot, ensureDirectory, filterProjectFiles, fingerprint,
  readRecord, sameFile, scanProject, syncError, uploadFile, withSyncWorkspace, writeRecord,
} from './oss-sync-engine.js'

const baselinePath = 'config/oss-sync.json'
const openFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const hashPattern = /^[a-f0-9]{64}$/
const collabTemp = /^config\/oss-sync\.json\.[a-f0-9-]{36}\.tmp$/i

function fileAllowed(file) {
  return isProjectFile(file) && !collabTemp.test(file)
}

function assertEntry(entry) {
  if (!entry || typeof entry.hash !== 'string' || !hashPattern.test(entry.hash) ||
      !Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw syncError('OSS_SYNC_STATE_FAILED')
  }
}

async function inspect(file) {
  try {
    return await lstat(file, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function walkParents(root, file, create) {
  const parents = file.split('/').slice(0, -1)
  let path = root
  for (const part of parents) {
    path = join(path, part)
    let info = await inspect(path)
    if (!info && create) {
      await mkdir(path).catch(error => {
        if (error.code !== 'EEXIST') throw error
      })
      info = await inspect(path)
    }
    if (!info) return 'missing'
    if (info.isSymbolicLink()) return 'symlink'
    if (!info.isDirectory()) return 'blocked'
  }
  return 'directory'
}

async function safeTarget(root, file, create = false) {
  const parent = await walkParents(root, file, create)
  if (parent === 'symlink' || parent === 'blocked') throw syncError('OSS_SYNC_INVALID_PATH')
  return join(root, file)
}

async function readLocalFile(file, signal, run) {
  checkStopped(signal)
  const handle = await open(file, openFlags)
  try {
    const info = await handle.stat({ bigint: true })
    if (!info.isFile()) throw syncError('OSS_SYNC_INVALID_PATH')
    const size = Number(info.size)
    if (!Number.isSafeInteger(size)) throw syncError('OSS_SYNC_FILE_UNREADABLE')
    const hash = await fingerprint(handle, size, signal)
    await checkSource(file, info)
    return await run(handle, info, { hash, size })
  } finally {
    await handle.close()
  }
}

async function matchLocal(file, expected, signal, run = (_handle, info) => info) {
  if (expected == null) {
    if (await inspect(file)) throw syncError('OSS_SYNC_FILE_CHANGED')
    return null
  }
  assertEntry(expected)
  try {
    return await readLocalFile(file, signal, async (handle, info, actual) => {
      if (actual.hash !== expected.hash || actual.size !== expected.size) throw syncError('OSS_SYNC_FILE_CHANGED')
      return run(handle, info)
    })
  } catch (error) {
    checkStopped(signal)
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) throw syncError('OSS_SYNC_FILE_CHANGED')
    throw error
  }
}

async function receiveFile(remote, entry, stage, signal) {
  const hash = createHash('sha256')
  let bytes = 0
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length
      if (bytes > entry.size) return done(syncError('OSS_SYNC_HASH_MISMATCH'))
      hash.update(chunk)
      done(null, chunk)
    },
  })

  try {
    const stream = await remote.getBlob(entry.hash)
    await pipeline(stream, meter, createWriteStream(stage, { mode: 0o600, flags: 'wx' }), { signal })
    if (bytes !== entry.size || hash.digest('hex') !== entry.hash) throw syncError('OSS_SYNC_HASH_MISMATCH')
  } catch (error) {
    checkStopped(signal)
    if (error.code === 'OSS_SYNC_HASH_MISMATCH') throw error
    const failure = syncError('OSS_SYNC_DOWNLOAD_FAILED')
    if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) failure.status = error.status
    throw failure
  }
}

export async function withLocalProject(projectRoot, signal, fn) {
  return withSyncWorkspace(projectRoot, signal, async ({ root, state, scratch }) => {
    let originalBaseline
    let conflictRoot

    async function backupLocal(file, target, expected) {
      if (!conflictRoot) {
        const conflicts = join(state, 'conflicts')
        await ensureDirectory(conflicts)
        conflictRoot = await mkdtemp(join(conflicts, 'revision-'))
      }
      const destination = await safeTarget(conflictRoot, file, true)
      const stage = join(scratch, 'backup-' + randomUUID())
      try {
        await matchLocal(target, expected, signal, async (handle, info) => {
          const hash = await createSnapshot(handle, expected.size, stage, signal)
          if (hash !== expected.hash) throw syncError('OSS_SYNC_FILE_CHANGED')
          await checkSource(target, info)
        })
        await link(stage, destination)
      } finally {
        await rm(stage, { force: true })
      }
      return destination.slice(root.length + 1)
    }

    async function readBaseline() {
      const target = await safeTarget(root, baselinePath)
      const current = await inspect(target)
      if (!current) {
        originalBaseline = null
        return null
      }
      if (!current.isFile()) throw syncError('OSS_SYNC_BASELINE_INVALID')
      let handle
      try {
        handle = await open(target, openFlags)
        const opened = await handle.stat({ bigint: true })
        if (!sameFile(current, opened)) throw syncError('OSS_SYNC_BASELINE_INVALID')
        const manifest = JSON.parse(await handle.readFile('utf8'))
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          throw syncError('OSS_SYNC_BASELINE_INVALID')
        }
        await checkSource(target, opened)
        originalBaseline = opened
        return manifest
      } catch {
        throw syncError('OSS_SYNC_BASELINE_INVALID')
      } finally {
        await handle?.close()
      }
    }

    return fn({
      async filterFiles(files) {
        const eligible = []
        try {
          for (const file of files) {
            checkStopped(signal)
            if (!fileAllowed(file)) continue
            // Git rejects paths beyond a symlink. Special entries stay outside synchronization.
            const parent = await walkParents(root, file, false)
            if (parent === 'symlink') continue
            const info = parent === 'directory' ? await inspect(join(root, file)) : null
            if (!info || info.isFile()) eligible.push(file)
          }
          return await filterProjectFiles(root, scratch, eligible, signal)
        } catch {
          checkStopped(signal)
          throw syncError('OSS_SYNC_SCAN_FAILED')
        }
      },

      async scan() {
        const files = Object.create(null)
        for (const { file } of await scanProject(root, scratch, signal)) {
          if (!fileAllowed(file)) continue
          try {
            const path = await safeTarget(root, file)
            files[file] = await readLocalFile(path, signal, (_handle, _info, entry) => entry)
          } catch (error) {
            checkStopped(signal)
            if (['OSS_SYNC_FILE_CHANGED', 'OSS_SYNC_INVALID_PATH', 'ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) {
              throw syncError('OSS_SYNC_FILE_CHANGED')
            }
            throw syncError('OSS_SYNC_FILE_UNREADABLE')
          }
        }
        return files
      },

      readBaseline,

      async writeBaseline(manifest) {
        checkStopped(signal)
        if (originalBaseline === undefined) await readBaseline()
        const target = await safeTarget(root, baselinePath, true)
        const current = await inspect(target)
        if (originalBaseline ? !current || !sameFile(originalBaseline, current) : current) {
          throw syncError('OSS_SYNC_BASELINE_INVALID')
        }
        await writeRecord(target, manifest)
        originalBaseline = await inspect(target)
      },

      async upload({ file, entry, remote, onProgress = () => {} }) {
        if (!fileAllowed(file)) throw syncError('OSS_SYNC_INVALID_PATH')
        assertEntry(entry)
        const path = await safeTarget(root, file)
        const stage = join(scratch, 'upload-' + randomUUID() + extname(file))
        try {
          let skipped
          const local = await matchLocal(path, entry, signal, async (handle, info) => {
            skipped = await remote.hasBlob(entry.hash)
            if (!skipped) {
              const hash = await createSnapshot(handle, entry.size, stage, signal)
              if (hash !== entry.hash) throw syncError('OSS_SYNC_FILE_CHANGED')
            }
            await checkSource(path, info)
            return info
          })
          if (skipped) return 'skipped'

          const checkpointRoot = join(state, 'checkpoints')
          await ensureDirectory(checkpointRoot)
          if (!hashPattern.test(remote.id)) throw syncError('OSS_SYNC_STATE_FAILED')
          const destination = join(checkpointRoot, remote.id)
          await ensureDirectory(destination)
          const recordFile = join(destination, entry.hash + '.json')
          const record = await readRecord(recordFile)
          const client = {
            put: (_key, snapshot) => remote.putBlob(entry.hash, snapshot, { size: entry.size }),
            multipartUpload: (_key, snapshot, options) => remote.putBlob(entry.hash, snapshot, {
              ...options, multipart: true, size: entry.size,
            }),
          }
          checkStopped(signal)
          await uploadFile({
            client, file, key: remote.blobKey(entry.hash), snapshot: stage, size: entry.size,
            fingerprint: entry.hash, checkpoint: record?.fingerprint === entry.hash ? record.checkpoint : null,
            recordFile, signal, progress: onProgress,
          })
          await rm(recordFile, { force: true })
          await checkSource(path, local)
          return 'uploaded'
        } finally {
          await rm(stage, { force: true })
        }
      },

      async download({ file, entry, expected, remote, backup = false }) {
        if (!fileAllowed(file)) throw syncError('OSS_SYNC_INVALID_PATH')
        assertEntry(entry)
        const target = await safeTarget(root, file)
        const current = await matchLocal(target, expected, signal)
        const stage = join(scratch, 'download-' + randomUUID())
        try {
          await receiveFile(remote, entry, stage, signal)
          checkStopped(signal)
          await safeTarget(root, file, true)
          const backupPath = backup && current ? await backupLocal(file, target, expected) : undefined
          if (current) {
            await checkSource(target, current)
            await chmod(stage, Number(current.mode) & 0o777)
            await checkSource(target, current)
            await rename(stage, target)
          } else {
            await chmod(stage, 0o666 & ~process.umask())
            await safeTarget(root, file)
            try {
              // A new download must never replace a file created since preview.
              await link(stage, target)
            } catch (error) {
              if (error.code === 'EEXIST') throw syncError('OSS_SYNC_FILE_CHANGED')
              throw error
            }
          }
          return { backup: backupPath }
        } finally {
          await rm(stage, { force: true })
        }
      },

      async remove({ file, expected }) {
        if (!fileAllowed(file)) throw syncError('OSS_SYNC_INVALID_PATH')
        assertEntry(expected)
        const target = await safeTarget(root, file)
        const current = await matchLocal(target, expected, signal)
        const backup = await backupLocal(file, target, expected)
        await checkSource(target, current)
        checkStopped(signal)
        await unlink(target)
        return { backup }
      },
    })
  })
}
