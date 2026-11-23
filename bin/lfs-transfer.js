import { createHash } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  checkStopped, createSnapshot, ensureDirectory, readRecord, sameFile, uploadFile,
} from '../server/oss-sync-engine.js'
import { openProjectStorage } from '../server/project-storage.js'

const oidPattern = /^[a-f0-9]{64}$/
const operationSet = new Set(['upload', 'download'])
const gatewayError = 'The OSS transfer failed. Check the project .env, OSS permissions and network.'
const messages = {
  OSS_NOT_CONFIGURED: 'Add OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET to the project .env.',
  OSS_INVALID_CONFIG: 'Check the OSS settings in the project .env.',
  OSS_SYNC_STATE_FAILED: 'Unable to save transfer state. Check free space and directory permissions.',
  OSS_SYNC_STOPPED: 'The OSS transfer was interrupted.',
  LFS_LOCAL_OBJECT_INVALID: 'The local LFS object does not match its SHA-256 or size.',
  LFS_REQUEST_INVALID: 'Invalid Git LFS transfer request.',
  LFS_REMOTE_OBJECT_INVALID: 'The OSS object does not match its LFS SHA-256 or size.',
  LFS_REMOTE_OBJECT_MISSING: 'The LFS object is missing from the configured OSS path.',
}

function transferError(code) {
  return Object.assign(new Error(messages[code]), { code })
}

function publicMessage(error) {
  if (Object.hasOwn(messages, error?.code)) return messages[error.code]
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? gatewayError + ' HTTP ' + error.status + '.'
    : gatewayError
}

function isMissing(error) {
  return error?.code === 'NoSuchKey' || (error?.status === 404 && error.code !== 'NoSuchBucket')
}

function objectKey(prefix, oid) {
  return [prefix, '__kacha_lfs__', 'objects', oid.slice(0, 2), oid].filter(Boolean).join('/')
}

function progressReporter(send, oid, size) {
  let previous = 0
  let updatedAt = 0
  return (bytes, final = false) => {
    if (!final && (bytes <= previous || Date.now() - updatedAt < 120)) return
    const current = final ? size : Math.max(previous, Math.min(size, bytes))
    send({ event: 'progress', oid, bytesSoFar: current, bytesSinceLast: current - previous })
    previous = current
    updatedAt = Date.now()
  }
}

async function verifyRemoteObject(client, key, oid, size, output, progress, signal) {
  checkStopped(signal)
  const hash = createHash('sha256')
  let received = 0
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length
      if (received > size) return done(transferError('LFS_REMOTE_OBJECT_INVALID'))
      hash.update(chunk)
      progress?.(received)
      done(null, chunk)
    },
  })
  const { stream } = await client.getStream(key, { headers: { 'Accept-Encoding': 'identity' } }).catch(error => {
    if (isMissing(error)) throw transferError('LFS_REMOTE_OBJECT_MISSING')
    throw error
  })
  const sink = output
    ? createWriteStream(output, { flags: 'wx', mode: 0o600 })
    : new Writable({ write(_chunk, _encoding, done) { done() } })
  await pipeline(stream, meter, sink, { signal })
  if (received !== size || hash.digest('hex') !== oid) throw transferError('LFS_REMOTE_OBJECT_INVALID')
}

async function alreadyUploaded(client, key, oid, size, signal) {
  const result = await client.head(key).catch(error => {
    if (isMissing(error)) return null
    throw error
  })
  if (!result) return false
  const headers = result.res?.headers || {}
  const recordedSize = headers['content-length']
  if (recordedSize !== undefined && Number(recordedSize) !== size) throw transferError('LFS_REMOTE_OBJECT_INVALID')
  if (Number(recordedSize) === size && headers['x-oss-meta-sha256'] === oid) return true

  // Older objects may have no checksum metadata. Verify their content before reusing the key.
  await verifyRemoteObject(client, key, oid, size, undefined, undefined, signal)
  return true
}

async function snapshotLocalObject(root, request, snapshot, signal) {
  const source = await open(resolve(root, request.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(() => { throw transferError('LFS_LOCAL_OBJECT_INVALID') })
  try {
    const before = await source.stat({ bigint: true })
    if (!before.isFile() || before.size !== BigInt(request.size)) throw transferError('LFS_LOCAL_OBJECT_INVALID')
    const digest = await createSnapshot(source, request.size, snapshot, signal)
    const after = await source.stat({ bigint: true })
    if (digest !== request.oid || !sameFile(before, after)) throw transferError('LFS_LOCAL_OBJECT_INVALID')
  } finally {
    await source.close()
  }
}

async function uploadObject({ client, key, root, scratch, checkpoints, request, progress, signal }) {
  const { oid, size } = request
  const snapshot = join(scratch, 'upload')
  await snapshotLocalObject(root, request, snapshot, signal)
  const recordFile = join(checkpoints, oid + '.json')
  if (!(await alreadyUploaded(client, key, oid, size, signal))) {
    checkStopped(signal)
    const record = await readRecord(recordFile)
    const options = { mime: 'application/octet-stream', meta: { sha256: oid } }
    const uploadClient = {
      put(name, file) {
        return client.put(name, file, options)
      },
      multipartUpload(name, file, multipartOptions) {
        return client.multipartUpload(name, file, {
          ...multipartOptions,
          ...options,
          // ali-oss sends a final 100% callback without a checkpoint.
          progress(fraction, current) {
            if (current) return multipartOptions.progress(fraction, current)
          },
        })
      },
    }
    await uploadFile({
      client: uploadClient, file: oid, key, snapshot, size, fingerprint: oid,
      checkpoint: record?.fingerprint === oid ? record.checkpoint : null,
      recordFile, signal, progress: percent => progress(Math.floor(size * percent / 100)),
    })
  }
  await rm(recordFile, { force: true })
  progress(size, true)
}

async function makeTransferDirectories(root, destination) {
  const cache = join(root, '.kacha')
  const state = join(cache, 'lfs-transfer')
  const id = createHash('sha256').update(JSON.stringify(destination)).digest('hex')
  const directory = join(state, id)
  const checkpoints = join(directory, 'multipart')
  for (const path of [cache, state, directory, checkpoints]) await ensureDirectory(path)
  return { directory, checkpoints }
}

// Git LFS reserves stdout for line-delimited JSON and sends requests serially to each worker.
export async function runLfsTransfer(projectRoot) {
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  const send = message => process.stdout.write(JSON.stringify(message) + '\n')
  const controller = new AbortController()
  const { signal } = controller
  const interrupt = () => {
    controller.abort()
    reader.close()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let session

  try {
    for await (const line of reader) {
      let request
      try {
        request = JSON.parse(line)
      } catch {
        throw transferError('LFS_REQUEST_INVALID')
      }
      if (!session) {
        if (request?.event !== 'init' || !operationSet.has(request.operation)) throw transferError('LFS_REQUEST_INVALID')
        try {
          const root = await realpath(projectRoot)
          const { client, destination } = await openProjectStorage({ root, timeout: 120000 })
          const { directory, checkpoints } = await makeTransferDirectories(root, destination)
          const scratch = await mkdtemp(join(directory, 'worker-'))
          session = { client, destination, root, scratch, checkpoints, operation: request.operation }
        } catch (error) {
          send({ error: { code: 1, message: publicMessage(error) } })
          return
        }
        send({})
        continue
      }

      if (request?.event === 'terminate') return
      const { oid, size, path } = request || {}
      const validOid = typeof oid === 'string' && oidPattern.test(oid)
      if (!validOid) throw transferError('LFS_REQUEST_INVALID')
      if (request.event !== session.operation || !Number.isSafeInteger(size) || size < 0 ||
        (session.operation === 'upload' && (typeof path !== 'string' || !path))) {
        send({ event: 'complete', oid, error: { code: 1, message: messages.LFS_REQUEST_INVALID } })
        continue
      }

      const { client, destination, root, scratch, checkpoints } = session
      const progress = progressReporter(send, oid, size)
      const key = objectKey(destination.prefix, oid)
      let work
      let transferred = false
      try {
        work = await mkdtemp(join(scratch, 'transfer-'))
        if (session.operation === 'upload') {
          await uploadObject({ client, key, root, scratch: work, checkpoints, request, progress, signal })
          send({ event: 'complete', oid })
        } else {
          const download = join(work, oid)
          await verifyRemoteObject(client, key, oid, size, download, progress, signal)
          progress(size, true)
          send({ event: 'complete', oid, path: download })
          transferred = true
        }
      } catch (error) {
        const message = signal.aborted ? messages.OSS_SYNC_STOPPED : publicMessage(error)
        send({ event: 'complete', oid, error: { code: 1, message } })
      } finally {
        // Git LFS moves a completed download into its cache before asking for another transfer.
        if (work && !transferred) await rm(work, { recursive: true, force: true }).catch(() => {})
      }
    }
  } finally {
    reader.close()
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    if (session) await rm(session.scratch, { recursive: true, force: true }).catch(() => {})
  }
}
