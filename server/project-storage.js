import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { projectRoot } from './project-paths.js'

const envPath = join(projectRoot, '.env')
const prefixKey = 'OSS_PREFIX'
const keys = {
  endpoint: 'OSS_ENDPOINT',
  bucket: 'OSS_BUCKET',
  keyId: 'OSS_ACCESS_KEY_ID',
  secret: 'OSS_ACCESS_KEY_SECRET',
}

const readEnv = (file = envPath) => readFile(file, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return ''
  throw error
})

function normalizeEndpoint(value) {
  const url = new URL(value.includes('://') ? value : 'https://' + value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Invalid endpoint')
  }
  return url.origin
}

export async function openProjectStorage({ root = projectRoot, timeout = 15000 } = {}) {
  try {
    const env = parseEnv(await readEnv(join(root, '.env')))
    const { endpoint, bucket, keyId, secret } = Object.fromEntries(
      Object.entries(keys).map(([field, key]) => [field, env[key]]),
    )
    if (!endpoint || !bucket || !keyId || !secret) {
      throw Object.assign(new Error('OSS settings are incomplete'), { code: 'OSS_NOT_CONFIGURED' })
    }
    const origin = normalizeEndpoint(endpoint)
    const prefix = (env[prefixKey] || '').trim().replace(/^\/+|\/+$/g, '')
    const { default: OSS } = await import('ali-oss')
    const client = new OSS({ endpoint: origin, bucket, accessKeyId: keyId, accessKeySecret: secret, timeout })
    return { client, destination: { endpoint: origin, bucket, prefix } }
  } catch (error) {
    if (error.code === 'OSS_NOT_CONFIGURED') throw error
    throw Object.assign(new Error('OSS settings could not be loaded'), { code: 'OSS_INVALID_CONFIG' })
  }
}

async function testStorage(req, res) {
  const send = (status, data) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(data))
  }
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403, {})
  if (req.method !== 'POST') return send(405, {})
  if (req.headers['content-type'] !== 'application/json') return send(415, {})

  let step = 'config'
  let object
  try {
    const { client, destination: { bucket, prefix } } = await openProjectStorage()
    const id = randomUUID()
    object = [prefix, 'kacha-oss-test-' + id + '.txt'].filter(Boolean).join('/')
    const content = Buffer.from('Kacha OSS connection test: ' + id + '\n')
    step = 'upload'
    await client.put(object, content, { mime: 'text/plain' })
    step = 'read'
    const result = await client.get(object)
    if (!Buffer.isBuffer(result.content) || !content.equals(result.content)) {
      return send(502, { step: 'verify', object })
    }
    return send(200, { bucket, object })
  } catch (error) {
    if (error.code === 'OSS_NOT_CONFIGURED') return send(400, { step })
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined
    return send(502, { step, status, object: step === 'read' ? object : undefined })
  }
}

export function projectStorage() {
  let pendingSave = Promise.resolve()
  return {
    name: 'workbench-project-storage',
    configureServer(server) {
      server.middlewares.use('/api/project-storage/test', testStorage)
      server.middlewares.use('/api/project-storage', async (req, res) => {
        const send = (status, data = {}) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(data))
        }
        if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403)
        if (req.method === 'GET') {
          try {
            const env = parseEnv(await readEnv())
            return send(200, {
              endpoint: env[keys.endpoint] || '',
              bucket: env[keys.bucket] || '',
              prefix: env[prefixKey] || '',
              hasKeyId: Boolean(env[keys.keyId]),
              hasSecret: Boolean(env[keys.secret]),
            })
          } catch {
            return send(500)
          }
        }
        if (req.method !== 'PUT') return send(405)
        if (req.headers['content-type'] !== 'application/json') return send(415)
        let values
        try {
          let body = ''
          req.setEncoding('utf8')
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            body += chunk
            if (body.length > 4096) {
              req.resume()
              return send(413)
            }
          }
          const fields = JSON.parse(body)
          if (!Object.keys(keys).every(key => typeof fields?.[key] === 'string')) return send(400)
          const { endpoint, bucket, prefix, keyId, secret } = fields
          if (prefix !== undefined && (typeof prefix !== 'string' || /["\x00-\x1f\x7f]/.test(prefix))) return send(400)
          if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket.trim())) return send(400)
          if ([keyId, secret].some(value => value && !/^[A-Za-z0-9+/=_-]+$/.test(value))) return send(400)
          values = { endpoint: normalizeEndpoint(endpoint.trim()), bucket: bucket.trim(), prefix: prefix?.trim().replace(/^\/+|\/+$/g, ''), keyId, secret }
        } catch {
          return send(400)
        }

        const save = pendingSave.then(async () => {
          const content = await readEnv()
          const existing = parseEnv(content)
          const entries = Object.entries(keys).map(([field, key]) => [key, values[field] || existing[key] || ''])
          if (entries.some(([, value]) => !value)) return false
          if (values.prefix !== undefined) entries.push([prefixKey, '"' + values.prefix + '"'])
          let next = content
          for (const [key, value] of entries) {
            const assignment = key + '=' + value
            const line = new RegExp('^[ \\t]*(?:export[ \\t]+)?' + key + '[ \\t]*=[^\\r\\n]*', 'gm')
            next = next.match(line) ? next.replace(line, () => assignment) : next.replace(/\n?$/, '\n' + assignment + '\n')
          }
          const temp = join(projectRoot, '.env.' + randomUUID() + '.tmp')
          try {
            await writeFile(temp, next.trimStart(), { mode: 0o600, flag: 'wx' })
            await rename(temp, envPath)
          } finally {
            await rm(temp, { force: true })
          }
          return true
        })
        pendingSave = save.catch(() => {})
        try {
          return send(await save ? 200 : 400)
        } catch {
          return send(500)
        }
      })
    },
  }
}
