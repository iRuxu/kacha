import { readFile, readdir } from 'node:fs/promises'
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
  for (const [extension, type] of Object.entries(logoTypes)) {
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
