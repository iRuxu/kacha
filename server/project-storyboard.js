import * as fs from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './project-paths.js'
import { streamMedia } from './image-assets.js'

const root = path.join(projectRoot, 'storyboard')
const videoRoot = path.join(projectRoot, 'dist', 'storyboard')
const numbered = /^\d{3}-.+/
const special = name => ['opening', 'ending'].includes(name)
const types = { __proto__: null, png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4' }
const mediaType = name => types[path.extname(name).slice(1).toLowerCase()]
const isDefault = name => /^index\./i.test(name)

async function entries(parts, base = root) {
  const dir = path.join(base, ...parts)
  if (await fs.realpath(dir).catch(() => '') !== dir) return []
  return (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
}

async function group(parts) {
  const media = []
  const local = await entries(parts)
  const outputs = (await entries(parts, videoRoot)).filter(entry => entry.isFile() && mediaType(entry.name)?.startsWith('video/'))
  const files = new Map([...local, ...outputs].map(entry => [entry.name, entry]))
  for (const entry of files.values()) {
    const type = mediaType(entry.name)
    if (!entry.isFile() || !type) continue
    const video = type.startsWith('video/')
    if (!video && !/^\d+-/.test(entry.name)) continue
    const base = outputs.includes(entry) ? videoRoot : root
    const stat = await fs.stat(path.join(base, ...parts, entry.name)).catch(() => null)
    if (!stat) continue
    media.push({ name: entry.name, video, primary: video && isDefault(entry.name),
      url: '/api/storyboard?file=' + encodeURIComponent([...parts, entry.name].join('/')) + '&modified=' + stat.mtimeMs })
  }
  media.sort((a, b) => Number(a.video) - Number(b.video) || Number(b.primary) - Number(a.primary))
  const documents = ['分镜.md', '生图.md', '即梦.md']
    .filter(name => local.some(entry => entry.isFile() && entry.name === name))
    .map(name => ({ name, file: ['storyboard', ...parts, name].join('/') }))
  return { name: parts.at(-1), media, documents }
}

export async function listStoryboard() {
  const episodes = []
  for (const episode of await entries([])) {
    if (!episode.isDirectory() || !(numbered.test(episode.name) || special(episode.name))) continue
    const scenes = []
    for (const scene of await entries([episode.name])) {
      if (!scene.isDirectory() || !(numbered.test(scene.name) || special(episode.name) && scene.name === '关键帧')) continue
      const parts = [episode.name, scene.name]
      const segments = (await entries(parts)).filter(e => e.isDirectory() && numbered.test(e.name))
      scenes.push({ name: scene.name, groups: segments.length ? await Promise.all(segments.map(e => group([...parts, e.name]))) : [await group(parts)] })
    }
    episodes.push({ name: episode.name, scenes })
  }
  return episodes.sort((a, b) => (a.name === 'opening' ? -1 : Number(a.name === 'ending')) - (b.name === 'opening' ? -1 : Number(b.name === 'ending')))
}

export function projectStoryboard() {
  return { name: 'workbench-storyboard', configureServer(server) {
    server.middlewares.use('/api/storyboard', async (req, res) => {
      try {
        if (req.method !== 'GET') { res.statusCode = 405; return res.end() }
        const file = new URL(req.url, 'http://localhost').searchParams.get('file')
        if (file === null) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.end(JSON.stringify(await listStoryboard()))
        }
        const parts = file.split('/')
        const [episode, scene] = parts
        const type = mediaType(parts.at(-1))
        if (![3, 4].includes(parts.length) || !(special(episode) || numbered.test(episode)) ||
          !(numbered.test(scene) || special(episode) && scene === '关键帧') ||
          (parts.length === 4 && !numbered.test(parts[2])) || !type) {
          res.statusCode = 404
          return res.end()
        }
        for (const base of type.startsWith('video/') ? [videoRoot, root] : [root]) {
          const target = path.join(base, ...parts)
          if (await fs.realpath(target).catch(() => '') !== target || !(await fs.stat(target)).isFile()) continue
          res.setHeader('Content-Type', type)
          return await streamMedia(target, req, res)
        }
        res.statusCode = 404
        return res.end()
      } catch { res.statusCode = 500; res.end() }
    })
  } }
}
