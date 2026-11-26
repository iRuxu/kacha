import path from 'node:path'
import { assetRoot, projectRoot } from './project-paths.js'

const roots = Object.fromEntries(['characters', 'scenes', 'props', 'other', 'audio'].map(kind => [
  kind, assetRoot(kind),
]))

roots.settings = path.join(projectRoot, 'docs')

roots.scripts = path.join(projectRoot, 'scripts')
roots.storyboard = path.join(projectRoot, 'storyboard')
const watched = [...Object.entries(roots), ...['scripts', 'storyboard'].map(kind =>
  [kind, path.join(projectRoot, 'dist', kind)])]

export function assetWatch() {
  return {
    name: 'workbench-asset-watch',
    configureServer(server) {
      const pending = new Map()
      const changes = new Map()
      server.watcher.add(watched.map(([, root]) => root))
      const onChange = (event, file) => {
        if (!['add', 'change', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return
        for (const [kind, root] of watched) {
          const relative = path.relative(root, file)
          if (relative.split(path.sep).some(part => part.startsWith('.')) || path.isAbsolute(relative)) continue
          if (!changes.has(kind)) changes.set(kind, new Set())
          changes.get(kind).add(path.relative(projectRoot, file).split(path.sep).join('/'))
          clearTimeout(pending.get(kind))
          pending.set(kind, setTimeout(() => {
            pending.delete(kind)
            server.ws.send({ type: 'custom', event: 'workbench:' + kind + ':changed', data: { files: [...changes.get(kind)] } })
            changes.delete(kind)
          }, 150))
        }
      }
      server.watcher.on('all', onChange)
      server.httpServer?.once('close', () => {
        server.watcher.off('all', onChange)
        for (const timer of pending.values()) clearTimeout(timer)
      })
    },
  }
}
