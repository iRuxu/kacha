import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './project-paths.js'

const logoTypes = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
}

const config = path.join(projectRoot, 'config')
const manifest = path.join(projectRoot, 'package.json')

async function readBrand() {
  const metadata = await readFile(manifest, 'utf8').then(JSON.parse).catch(() => null)
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : ''
  const description = typeof metadata?.description === 'string' ? metadata.description.trim() : ''
  const files = await readdir(config, { withFileTypes: true }).catch(() => [])
  const preferred = metadata?.kacha?.logo
  const extensions = Object.keys(logoTypes)
  if (extensions.includes(preferred)) extensions.unshift(...extensions.splice(extensions.indexOf(preferred), 1))
  for (const extension of extensions) {
    const type = logoTypes[extension]
    const filename = 'logo.' + extension
    if (!files.some(file => file.name === filename && file.isFile())) continue
    const image = await readFile(path.join(config, filename)).catch(() => null)
    if (image?.length) return { name, description, logo: 'data:' + type + ';base64,' + image.toString('base64') }
  }
  return { name, description, logo: '' }
}

export function projectBrand() {
  const id = 'virtual:project-brand'
  return {
    name: 'workbench-project-brand',
    resolveId(source) {
      if (source === id) return '\0' + id
    },
    async load(source) {
      if (source === '\0' + id) return 'export default ' + JSON.stringify(await readBrand())
    },
    configureServer(server) {
      let pendingSave = Promise.resolve()
      server.middlewares.use('/api/project-config', async (req, res) => {
        const send = (status, data) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        if (req.method !== 'PUT') return send(405, {})
        if (req.headers['content-type'] !== 'application/json') return send(415, {})

        let fields
        try {
          const chunks = []
          let size = 0
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            size += chunk.length
            if (size > 3 * 1024 * 1024) {
              req.resume()
              return send(413, {})
            }
            chunks.push(chunk)
          }
          fields = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, {})
        }
        if (typeof fields?.name !== 'string' || typeof fields?.description !== 'string') return send(400, {})
        const upload = fields.logo
        let image
        if (upload != null) {
          if (!Object.hasOwn(logoTypes, upload.extension) || typeof upload.data !== 'string') return send(400, {})
          image = Buffer.from(upload.data, 'base64')
          if (!image.length || image.length > 2 * 1024 * 1024 || image.toString('base64') !== upload.data) return send(400, {})
        }
        const name = fields.name.trim()
        const description = fields.description.trim()
        const save = pendingSave.then(async () => {
          const metadata = await readFile(manifest, 'utf8').then(JSON.parse).catch(error => {
            if (error.code === 'ENOENT') return { private: true }
            throw error
          })
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid project manifest')
          const temp = path.join(projectRoot, '.' + randomUUID() + '.tmp')
          const logoTemp = path.join(config, path.basename(temp))
          const updated = { ...metadata, name, description }
          if (image) updated.kacha = { ...metadata.kacha, logo: upload.extension }
          const logoPath = image ? path.join(config, 'logo.' + upload.extension) : null
          let priorLogo
          let logoWritten = false
          try {
            await writeFile(temp, JSON.stringify(updated, null, 2) + '\n')
            if (image) {
              await mkdir(config, { recursive: true })
              priorLogo = await readFile(logoPath).catch(error => {
                if (error.code !== 'ENOENT') throw error
              })
              await writeFile(logoTemp, image)
              await rename(logoTemp, logoPath)
              logoWritten = true
            }
            await rename(temp, manifest)
          } catch (error) {
            if (logoWritten) {
              if (priorLogo) {
                await writeFile(logoTemp, priorLogo)
                await rename(logoTemp, logoPath)
              } else {
                await rm(logoPath, { force: true })
              }
            }
            throw error
          } finally {
            await rm(temp, { force: true })
            if (image) await rm(logoTemp, { force: true })
          }
        })
        pendingSave = save.catch(() => {})
        try {
          await save
          const module = server.moduleGraph.getModuleById('\0' + id)
          if (module) server.moduleGraph.invalidateModule(module)
          send(200, { name, description })
        } catch {
          send(500, {})
        }
      })
      const refresh = filename => {
        if (filename !== manifest && !filename.startsWith(path.join(config, 'logo.'))) return
        const module = server.moduleGraph.getModuleById('\0' + id)
        if (!module) return
        server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.add([manifest, config])
      server.watcher.on('add', refresh).on('change', refresh).on('unlink', refresh)
    },
  }
}
