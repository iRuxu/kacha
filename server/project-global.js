import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { projectRoot } from './project-paths.js'

const id = 'virtual:project-global'
const file = join(projectRoot, 'config', 'global.json')

async function readSettings() {
  try {
    const settings = JSON.parse(await readFile(file, 'utf8'))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('Invalid global settings')
    }
    return settings
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export function projectGlobal() {
  let pendingSave = Promise.resolve()
  return {
    name: 'workbench-project-global',
    resolveId(source) {
      if (source === id) return '\0' + id
    },
    async load(source) {
      if (source !== '\0' + id) return
      const { locale } = await readSettings().catch(() => ({}))
      return 'export default ' + JSON.stringify({ locale, projectRoot })
    },
    configureServer(server) {
      server.middlewares.use('/api/project-global', async (req, res) => {
        const send = status => {
          res.statusCode = status
          res.end()
        }
        if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403)
        if (req.method !== 'PUT') return send(405)
        if (req.headers['content-type'] !== 'application/json') return send(415)
        let locale
        try {
          let body = ''
          req.setEncoding('utf8')
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            body += chunk
            if (body.length > 1024) {
              req.resume()
              return send(413)
            }
          }
          locale = JSON.parse(body)?.locale
        } catch {
          return send(400)
        }
        if (locale !== 'zh-CN' && locale !== 'en') return send(400)

        const save = pendingSave.then(async () => {
          const settings = await readSettings()
          await mkdir(dirname(file), { recursive: true })
          const temp = file + '.' + randomUUID() + '.tmp'
          try {
            await writeFile(temp, JSON.stringify({ ...settings, locale }, null, 2) + '\n')
            await rename(temp, file)
          } finally {
            await rm(temp, { force: true })
          }
        })
        pendingSave = save.catch(() => {})
        try {
          await save
          const module = server.moduleGraph.getModuleById('\0' + id)
          if (module) server.moduleGraph.invalidateModule(module)
          return send(204)
        } catch {
          return send(500)
        }
      })
    },
  }
}
