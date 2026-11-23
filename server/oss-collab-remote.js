import { createHash } from 'node:crypto'

const directory = '__kacha_sync__'
const hashPattern = /^[a-f0-9]{64}$/
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const metadataLimit = 64 * 1024 * 1024
const multipartThreshold = 32 * 1024 * 1024
const digest = data => createHash('sha256').update(data).digest('hex')

function errorFor(code) {
  return Object.assign(new Error(code), { code })
}

function invalid() {
  return errorFor('OSS_COLLAB_REMOTE_INVALID')
}

function validString(value, pattern) {
  return typeof value === 'string' && pattern.test(value)
}

function isMissing(error) {
  return error?.code === 'NoSuchKey' || (error?.status === 404 && error.code !== 'NoSuchBucket')
}

function checkStopped(signal) {
  if (signal?.aborted) throw errorFor('OSS_SYNC_STOPPED')
}

export function isProjectFile(file) {
  if (typeof file !== 'string' || /[\\:\x00-\x1f\x7f]/.test(file)) return false
  return file.toLowerCase() !== 'config/oss-sync.json' && file.split('/').every(part => {
    const name = part.toLowerCase()
    return name.trimEnd() === name && name && !name.endsWith('.') &&
      !['.git', '.kacha', '.env', 'node_modules', directory].includes(name) && !name.startsWith('.env.')
  })
}

export function assertPortablePaths(paths) {
  const files = new Set(paths)
  // A project can move to a case-insensitive or Unicode-normalizing filesystem.
  const pathSpellings = new Map()
  for (const file of files) {
    let end = file.indexOf('/')
    while (true) {
      const part = end < 0 ? file : file.slice(0, end)
      const canonical = part.toUpperCase().toLowerCase().normalize('NFC')
      const spelling = pathSpellings.get(canonical)
      if ((spelling && spelling !== part) || (end >= 0 && files.has(part))) throw invalid()
      pathSpellings.set(canonical, part)
      if (end < 0) break
      end = file.indexOf('/', end + 1)
    }
  }
}

export function validateManifest(value) {
  if (!value || !validString(value.projectId, idPattern) || !validString(value.revision, idPattern) ||
    (value.parent !== null && !validString(value.parent, idPattern)) || value.parent === value.revision ||
    typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw invalid()

  const files = Object.create(null)
  const sizes = new Map()
  for (const [file, item] of Object.entries(value.files)) {
    if (!isProjectFile(file) || !item || !validString(item.hash, hashPattern) ||
      !Number.isSafeInteger(item.size) || item.size < 0) throw invalid()
    if (sizes.has(item.hash) && sizes.get(item.hash) !== item.size) throw invalid()
    sizes.set(item.hash, item.size)
    files[file] = { hash: item.hash, size: item.size }
  }

  assertPortablePaths(Object.keys(files))
  const { projectId, revision, parent, createdAt } = value
  return { projectId, revision, parent, createdAt, files }
}

export function createRemoteStore(client, destination) {
  const prefix = (destination.prefix || '').replace(/^\/+|\/+$/g, '')
  const relativeKey = path => prefix ? prefix + '/' + path : path
  const managedKey = key => relativeKey(directory + '/' + key)
  const logKey = managedKey('published.jsonl')
  const blobKey = hash => {
    if (!validString(hash, hashPattern)) throw invalid()
    return managedKey('blobs/' + hash)
  }
  const manifestKey = ({ revision, hash }) => managedKey('versions/' + revision + '/' + hash + '.json')

  async function readMetadata(key) {
    try {
      const { stream } = await client.getStream(key, { headers: { 'Accept-Encoding': 'identity' } })
      const chunks = []
      let bytes = 0
      try {
        for await (const chunk of stream) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += data.length
          if (bytes > metadataLimit) throw invalid()
          chunks.push(data)
        }
      } finally {
        stream.destroy()
      }
      return Buffer.concat(chunks, bytes)
    } catch (error) {
      if (isMissing(error)) return null
      if (error?.code === 'OSS_COLLAB_REMOTE_INVALID') throw error
      throw errorFor('OSS_COLLAB_REMOTE_IO')
    }
  }

  async function readLog() {
    const data = await readMetadata(logKey)
    if (!data) return { position: 0, records: [] }

    try {
      const rows = data.toString('utf8').split('\n')
      if (rows.pop() !== '') throw invalid()
      const revisions = new Set()
      const records = []
      for (const line of rows) {
        const item = JSON.parse(line)
        const previous = records.at(-1)
        if (!item || item.version !== 1 || !validString(item.projectId, idPattern) ||
          !validString(item.revision, idPattern) || !validString(item.hash, hashPattern) ||
          item.parent !== (previous?.revision || null) || (previous && item.projectId !== previous.projectId) ||
          revisions.has(item.revision)) throw invalid()
        records.push(item)
        revisions.add(item.revision)
      }
      if (!records.length) throw invalid()
      return { position: data.length, records }
    } catch {
      throw invalid()
    }
  }

  async function readHead() {
    const { position, records } = await readLog()
    const latest = records.at(-1)
    if (!latest) return { position, manifest: null }
    const bytes = await readMetadata(manifestKey(latest))
    if (!bytes || digest(bytes) !== latest.hash) throw invalid()
    try {
      const manifest = validateManifest(JSON.parse(bytes))
      if (manifest.revision !== latest.revision || manifest.projectId !== latest.projectId || manifest.parent !== latest.parent) {
        throw invalid()
      }
      return { position, manifest }
    } catch {
      throw invalid()
    }
  }

  async function publish(input, expectedHead) {
    const manifest = validateManifest(input)
    const { projectId, revision, parent } = manifest
    if (!Number.isSafeInteger(expectedHead?.position) || expectedHead.position < 0 ||
      ((expectedHead.position === 0) !== !expectedHead.manifest) ||
      (expectedHead.manifest && expectedHead.manifest.projectId !== projectId) ||
      parent !== (expectedHead.manifest?.revision || null)) throw invalid()
    const payload = Buffer.from(JSON.stringify(manifest) + '\n')
    if (payload.length > metadataLimit) throw invalid()
    const record = { version: 1, projectId, revision, parent, hash: digest(payload) }
    const entry = Buffer.from(JSON.stringify(record) + '\n')
    const nextPosition = expectedHead.position + entry.length
    if (nextPosition > metadataLimit) throw invalid()

    try {
      // This key identifies the exact bytes. Concurrent retries can only put the same payload.
      await client.put(manifestKey(record), payload, { mime: 'application/json' })
      await client.append(logKey, entry, { position: expectedHead.position, mime: 'application/x-ndjson' })
      return { position: nextPosition, manifest }
    } catch (error) {
      // A transport error can arrive after successful append. The log decides whether to retry.
      let latest
      try {
        latest = await readLog()
      } catch (readError) {
        if (readError?.code === 'OSS_COLLAB_REMOTE_INVALID') throw readError
        if (error?.code === 'PositionNotEqualToLength') throw errorFor('OSS_COLLAB_REMOTE_CHANGED')
        throw errorFor('OSS_COLLAB_REMOTE_IO')
      }
      const published = latest.records.find(item => item.revision === revision)
      if (published?.hash === record.hash) return { position: latest.position, manifest }
      if (error?.code === 'ObjectNotAppendable') throw invalid()
      if (published || latest.position !== expectedHead.position || error?.code === 'PositionNotEqualToLength') {
        throw errorFor('OSS_COLLAB_REMOTE_CHANGED')
      }
      throw errorFor('OSS_COLLAB_REMOTE_IO')
    }
  }

  async function getBlob(hash) {
    const key = blobKey(hash)
    return (await client.getStream(key, { headers: { 'Accept-Encoding': 'identity' } })).stream
  }

  async function hasBlob(hash) {
    const key = blobKey(hash)
    try {
      await client.head(key)
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  function putBlob(hash, file, { multipart = false, size = 0, checkpoint, ...options } = {}) {
    const key = blobKey(hash)
    if (checkpoint || multipart || size >= multipartThreshold) {
      return client.multipartUpload(key, file, { ...options, checkpoint })
    }
    return client.put(key, file, options)
  }

  async function listLegacy() {
    const directoryPrefix = prefix && prefix + '/'
    const matched = new Map()
    const tokens = new Set()
    let token
    try {
      do {
        const page = await client.listV2({ prefix: directoryPrefix, 'max-keys': 1000, continuationToken: token })
        for (const item of page.objects || []) {
          if (typeof item.name !== 'string' || !item.name.startsWith(directoryPrefix)) continue
          const file = item.name.slice(directoryPrefix.length)
          if (isProjectFile(file) && Number.isSafeInteger(item.size) && item.size >= 0) {
            matched.set(file, { size: item.size, etag: item.etag })
          }
        }
        if (!page.isTruncated) return matched
        token = page.nextContinuationToken
        if (typeof token !== 'string' || !token || tokens.has(token)) throw invalid()
        tokens.add(token)
      } while (true)
    } catch (error) {
      if (error?.code === 'OSS_COLLAB_REMOTE_INVALID') throw error
      throw errorFor('OSS_COLLAB_REMOTE_IO')
    }
  }

  async function reuseLegacy(file, hash, size, signal) {
    if (!isProjectFile(file)) throw invalid()
    const key = blobKey(hash)
    const source = relativeKey(file)
    let stream
    const stop = () => stream?.destroy(errorFor('OSS_SYNC_STOPPED'))
    try {
      checkStopped(signal)
      const result = await client.getStream(source, { headers: { 'Accept-Encoding': 'identity' } })
      stream = result.stream
      const etag = result.res?.headers?.etag
      const length = result.res?.headers?.['content-length']
      checkStopped(signal)
      if (!validString(etag, /^"?[a-z0-9-]+"?$/i) || (length !== undefined && Number(length) !== size)) return false

      const check = createHash('sha256')
      let actualSize = 0
      signal?.addEventListener('abort', stop, { once: true })
      for await (const chunk of stream) {
        checkStopped(signal)
        actualSize += chunk.length
        if (actualSize > size) return false
        check.update(chunk)
      }
      checkStopped(signal)
      if (actualSize !== size || check.digest('hex') !== hash) return false

      // The source can be overwritten by older clients. Tie the copy to what was just verified.
      const copied = await client.copy(key, source, destination.bucket, { headers: { 'if-match': etag } })
      return copied.res?.status === 200
    } catch (error) {
      checkStopped(signal)
      if (isMissing(error) || [403, 412, 501].includes(error?.status)) return false
      throw errorFor('OSS_COLLAB_REMOTE_IO')
    } finally {
      signal?.removeEventListener('abort', stop)
      stream?.destroy()
    }
  }

  return {
    id: digest(JSON.stringify([destination.endpoint, destination.bucket, prefix])),
    readHead, publish, blobKey, getBlob, hasBlob, putBlob, listLegacy, reuseLegacy,
  }
}
