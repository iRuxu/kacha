import path from 'node:path'
import { assetRoot, projectRoot } from './project-paths.js'

const roots = Object.fromEntries(['characters', 'scenes', 'props', 'other', 'audio'].map(kind => [
  kind, assetRoot(kind),
]))

roots.settings = path.join(projectRoot, 'docs')

export function assetWatch() {
  return {
    name: 'workbench-asset-watch',
    configureServer(server) {
      const pending = new Map()
      server.watcher.add(Object.values(roots))
      const onChange = (event, file) => {
        if (!['add', 'change', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return
        for (const [kind, root] of Object.entries(roots)) {
          const relative = path.relative(root, file)
          if (relative.split(path.sep).some(part => part.startsWith('.')) || path.isAbsolute(relative)) continue
          clearTimeout(pending.get(kind))
          pending.set(kind, setTimeout(() => {
            pending.delete(kind)
            server.ws.send({ type: 'custom', event: 'workbench:' + kind + ':changed', data: {} })
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
