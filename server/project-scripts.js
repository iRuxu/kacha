import * as fs from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './project-paths.js'
import { streamMedia } from './image-assets.js'

const root = path.join(projectRoot, 'scripts')
const episodeName = /^\d{3}-.+/
const videoTypes = new Map([
  ['.mp4', 'video/mp4'], ['.mov', 'video/quicktime'], ['.webm', 'video/webm'],
  ['.m4v', 'video/mp4'], ['.mkv', 'video/x-matroska'],
])

function acceptedDirectory(name) {
  return name === 'opening' || name === 'ending' || episodeName.test(name)
}

async function entries(directory) {
  if (await fs.realpath(directory).catch(() => '') !== directory) return []
  return fs.readdir(directory, { withFileTypes: true })
}

function compareFiles(a, b) {
  return a.localeCompare(b, undefined, { numeric: true })
}

export async function listScripts() {
  const directories = (await entries(root))
    .filter(entry => entry.isDirectory() && acceptedDirectory(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => {
      if (a === 'opening' || b === 'ending') return -1
      if (b === 'opening' || a === 'ending') return 1
      return compareFiles(a, b)
    })

  return Promise.all(directories.map(async name => {
    const directory = path.join(root, name)
    const files = (await entries(directory)).filter(entry => entry.isFile()).map(entry => entry.name).sort(compareFiles)
    const archived = (await entries(path.join(directory, 'archive')))
      .filter(entry => entry.isFile()).map(entry => entry.name).sort(compareFiles).reverse()
    const documents = files.filter(file => /\.(md|markdown)$/i.test(file))
    return {
      name,
      documents: documents.includes('index.md')
        ? ['index.md', ...documents.filter(file => file !== 'index.md')]
        : documents,
      history: archived.filter(file => /\.(md|markdown)$/i.test(file)),
      videos: files.filter(file => videoTypes.has(path.extname(file).toLowerCase())),
    }
  }))
}

export function projectScripts() {
  return {
    name: 'workbench-project-scripts',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/api/scripts') return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          return res.end()
        }
        try {
          const video = url.searchParams.get('video')
          if (video === null) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            return res.end(JSON.stringify(await listScripts()))
          }
          const [directory, filename, ...rest] = video.split('/')
          const type = videoTypes.get(path.extname(filename || '').toLowerCase())
          if (acceptedDirectory(directory) && type && !rest.length && path.basename(filename) === filename) {
            const file = path.join(root, directory, filename)
            if (await fs.realpath(file).catch(() => '') === file && (await fs.stat(file)).isFile()) {
              res.setHeader('Content-Type', type)
              res.setHeader('X-Content-Type-Options', 'nosniff')
              return await streamMedia(file, req, res)
            }
          }
          res.statusCode = 404
          return res.end()
        } catch (cause) {
          res.statusCode = cause.code === 'ENOENT' ? 404 : 500
          return res.end()
        }
      })
    },
  }
}
