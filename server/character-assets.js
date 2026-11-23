import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { assetRoot } from './project-paths.js'
import { randomUUID } from 'node:crypto'
import { deleteAssetDirectory, isAssetFolderName, scanAssets } from './asset-directories.js'

const root = assetRoot('characters')
const index = 'index.json'
const slots = {
  image2d: { stem: '2d-turnaround', legacyStem: '2d', formats: ['png', 'jpg', 'jpeg', 'webp', 'avif'], legacy: '原画三视图.png' },
  image3d: { stem: '3d-turnaround', legacyStem: '3d', formats: ['png', 'jpg', 'jpeg', 'webp', 'avif'], legacy: '3D三视图.png' },
  model3d: { stem: 'model', formats: ['glb'] },
  voice: { stem: 'voice/index', formats: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] },
}
const types = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
  glb: 'model/gltf-binary', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
}
const extension = file => path.extname(file).slice(1).toLowerCase()
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/')
const url = (dir, file) => file ? '/character-media?file=' + encodeURIComponent(relative(root, path.join(dir, file))) : null
const inside = (base, file) => file.startsWith(path.resolve(base) + path.sep)
const fail = (status, message) => Object.assign(new Error(message), { status })

async function entries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function read(file, fallback) {
  try {
    if (!(await fs.lstat(file)).isFile()) return fallback
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function metadata(dir) {
  return JSON.parse(await read(path.join(dir, index), '{}'))
}

async function currentFiles(dir, data) {
  const files = {}
  for (const [key, slot] of Object.entries(slots)) {
    const configured = data[key]
    const acceptable = typeof configured === 'string'
      && (key === 'voice' ? /^voice\/index\.[^/\\]+$/.test(configured) : path.basename(configured) === configured && !configured.includes('\\'))
      && slot.formats.includes(extension(configured))
    const candidates = [
      ...(acceptable ? [configured] : []),
      ...slot.formats.map(format => slot.stem + '.' + format),
      ...(slot.legacyStem ? slot.formats.map(format => slot.legacyStem + '.' + format) : []),
      slot.legacy,
    ]
    for (const file of candidates.filter(Boolean)) {
      const absolute = path.join(dir, file)
      const real = await fs.realpath(absolute).catch(() => '')
      if (real === absolute && (await fs.stat(real)).isFile()) {
        files[key] = file
        break
      }
    }
  }
  return files
}

async function describe(dir, groups = []) {
  const data = await metadata(dir)
  const files = await currentFiles(dir, data)
  const hiddenGroupTags = new Set(Array.isArray(data.hiddenGroupTags) ? data.hiddenGroupTags : [])
  const media = {}
  for (const [key, file] of Object.entries(files)) {
    const stat = await fs.stat(path.join(dir, file))
    media[key] = url(dir, file) + '&modified=' + stat.mtimeMs
  }
  const extraVoice = []
  for (const folder of ['voice', '音色参考']) {
    const absolute = path.join(dir, folder)
    if (await fs.realpath(absolute).catch(() => '') !== absolute) continue
    for (const item of await entries(absolute)) {
      const file = folder + '/' + item.name
      if (!item.isFile() || !slots.voice.formats.includes(extension(file)) || file === files.voice) continue
      extraVoice.push({ name: item.name, url: url(dir, file) })
    }
  }
  return {
    id: relative(root, dir),
    name: path.basename(dir),
    tags: [...new Set([...(Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === 'string') : []), ...groups.filter(tag => !hiddenGroupTags.has(tag))])],
    media,
    main: [data.mainImage, 'image3d', 'image2d'].find(key => ['image2d', 'image3d'].includes(key) && media[key]) || null,
    extraVoice,
  }
}

async function list() {
  const assets = await scanAssets(root)
  const characters = await Promise.all(assets.map(asset => describe(asset.dir, asset.groups)))
  return characters.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

async function getDirectory(id) {
  const asset = (await scanAssets(root)).find(entry => entry.id === id)
  if (!asset) throw fail(404, '找不到角色目录')
  return asset
}

async function galleryImages(dir, folder, prompts, excluded = new Set()) {
  const absolute = path.resolve(dir, folder)
  if (!inside(dir, absolute) || excluded.has(absolute) || await fs.realpath(absolute).catch(() => '') !== absolute) return []
  if (!(await fs.stat(absolute)).isDirectory()) return []
  const images = []
  for (const item of (await entries(absolute)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
    if (item.name.startsWith('.') || item.name === 'archive') continue
    const itemPath = path.join(absolute, item.name)
    const file = relative(dir, itemPath)
    if (item.isDirectory()) {
      images.push(...await galleryImages(dir, file, prompts, excluded))
    } else if (item.isFile() && types[extension(item.name)]?.startsWith('image/')) {
      const modified = (await fs.stat(itemPath)).mtimeMs
      images.push({
        file,
        name: path.parse(item.name).name,
        url: url(dir, file) + '&modified=' + modified,
        prompt: typeof prompts?.[file] === 'string' ? prompts[file] : '',
      })
    }
  }
  return images
}

async function characterGalleries(dir, data) {
  const folders = new Set(['skin', 'skins'])
  for (const skin of Array.isArray(data.skins) ? data.skins : []) {
    if (typeof skin?.folder !== 'string') continue
    const fullPath = path.resolve(dir, skin.folder)
    const folder = relative(dir, fullPath)
    if (!inside(dir, fullPath) || folder.split('/').some(part => part === 'archive' || part.startsWith('.'))) continue
    folders.add(folder)
  }
  const images = new Map()
  for (const folder of folders) {
    for (const image of await galleryImages(dir, folder, data.assetPrompts)) images.set(image.file, image)
  }
  const skins = [...images.values()]
  const excluded = new Set([...folders].map(folder => path.join(dir, folder)))
  const portraits = [
    ...await galleryImages(dir, 'portraits', data.assetPrompts, excluded),
    ...await galleryImages(dir, '特写', data.assetPrompts, excluded),
  ]
  return { portraits, skins }
}

async function detail(dir, groups = []) {
  const data = await metadata(dir)
  const archive = path.join(dir, 'archive')
  const history = []
  const versions = Array.isArray(data.history) ? data.history : []
  if (await fs.realpath(archive).catch(() => '') === archive) {
    for (const item of await entries(archive)) {
      if (!item.isDirectory() || item.name === '生成记录' || item.name.startsWith('.')) continue
      const version = path.join(archive, item.name)
      const previous = await metadata(version)
      const listed = versions.find(entry => entry.version === item.name)
      const directoryDate = /^\d{4}-\d{2}-\d{2}(?=-|$)/.exec(item.name)?.[0]
      const createdAt = listed?.archivedAt || directoryDate || (await fs.stat(version)).birthtime.toISOString()
      history.push({
        version: item.name,
        createdAt,
        timeSource: listed?.archivedAt || directoryDate ? 'archive' : 'directory',
        changes: listed?.changes || [],
        prompts: previous.prompts || {},
        files: (await entries(version)).filter(file => file.isFile() && types[extension(file.name)])
          .map(file => ({ name: file.name, url: url(version, file.name), type: types[extension(file.name)] })),
        story: await read(path.join(version, 'README.md'), ''),
      })
    }
  }
  return {
    ...await describe(dir, groups),
    ...await characterGalleries(dir, data),
    note: typeof data.note === 'string' ? data.note : '',
    savedTags: Array.isArray(data.tags) ? data.tags : [],
    story: await read(path.join(dir, 'README.md'), ''),
    prompts: data.prompts || {},
    history: history.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true })),
  }
}

function nameOf(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || !isAssetFolderName(name) || /[/\\:\u0000-\u001f]/.test(name)) {
    throw fail(400, '请输入有效的角色名称')
  }
  return name
}

async function ensureAvailable(dir) {
  if (await fs.lstat(dir).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return null
  })) throw fail(409, '已有同名角色目录')
}

async function writeAtomic(file, contents) {
  const temp = path.join(path.dirname(file), '.' + randomUUID() + '.tmp')
  try {
    await fs.writeFile(temp, contents)
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

const writeIndex = (dir, data) => writeAtomic(path.join(dir, index), JSON.stringify(data, null, 2) + '\n')

async function archiveChanges(dir, data, files, patch) {
  const oldStory = await read(path.join(dir, 'README.md'), null)
  const changed = []
  const previous = []
  if (patch.upload) {
    changed.push(patch.upload.slot)
    const oldFile = files[patch.upload.slot]
    if (oldFile) previous.push(oldFile)
  }
  if (typeof patch.story === 'string' && patch.story !== (oldStory || '')) {
    changed.push('story')
    if (oldStory !== null) previous.push('README.md')
  }
  if (patch.prompts && JSON.stringify(patch.prompts) !== JSON.stringify(data.prompts || {})) {
    changed.push('prompts')
  }
  if (!previous.length && !(changed.includes('prompts') && Object.values(data.prompts || {}).some(Boolean))) return
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const archive = path.join(dir, 'archive')
  await fs.mkdir(archive, { recursive: true })
  if (await fs.realpath(archive) !== archive) throw fail(400, '归档目录必须位于角色文件夹内')
  let sequence = 1
  for (const entry of await entries(archive)) {
    const match = /^\d{4}-\d{2}-\d{2}-v(\d+)$/.exec(entry.name)
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1)
  }
  const version = date + '-v' + String(sequence).padStart(3, '0')
  const destination = path.join(archive, version)
  await fs.mkdir(destination)
  for (const oldFile of previous) await fs.copyFile(path.join(dir, oldFile), path.join(destination, path.basename(oldFile)))
  await writeIndex(destination, data)
  data.history = [...(Array.isArray(data.history) ? data.history : []), { version, changes: changed, archivedAt: new Date().toISOString() }]
}

async function update(dir, patch, groups) {
  const data = await metadata(dir)
  const files = await currentFiles(dir, data)
  const name = 'name' in patch ? nameOf(patch.name) : path.basename(dir)
  const next = path.join(path.dirname(dir), name)
  if (next !== dir) await ensureAvailable(next)
  let uploadFile
  if (patch.upload) {
    const slot = Object.hasOwn(slots, patch.upload.slot) && slots[patch.upload.slot]
    const format = typeof patch.upload.filename === 'string' && extension(patch.upload.filename)
    if (!slot || !slot.formats.includes(format) || typeof patch.upload.base64 !== 'string') {
      throw fail(400, '素材类型不受支持')
    }
    uploadFile = slot.stem + '.' + format
    const folder = path.dirname(path.join(dir, uploadFile))
    await fs.mkdir(folder, { recursive: true })
    if (await fs.realpath(folder) !== folder) throw fail(400, '素材目录必须位于角色文件夹内')
  }
  if ('mainImage' in patch && !['image2d', 'image3d'].includes(patch.mainImage)) throw fail(400, '请选择有效主图')
  if ('note' in patch && typeof patch.note !== 'string') throw fail(400, '备注必须是文本')
  if ('tags' in patch && (!Array.isArray(patch.tags) || patch.tags.some(tag => typeof tag !== 'string'))) {
    throw fail(400, '标签必须是文本数组')
  }
  if (patch.upload && typeof patch.upload.prompt === 'string') {
    patch.prompts = { ...(data.prompts || {}), [patch.upload.slot]: patch.upload.prompt }
  }
  if ('prompts' in patch && (!patch.prompts || typeof patch.prompts !== 'object'
    || Object.entries(patch.prompts).some(([key, value]) => !Object.hasOwn(slots, key) || typeof value !== 'string'))) {
    throw fail(400, '生成词格式无效')
  }
  await archiveChanges(dir, data, files, patch)
  if (uploadFile) {
    await writeAtomic(path.join(dir, uploadFile), Buffer.from(patch.upload.base64, 'base64'))
    data[patch.upload.slot] = uploadFile
  }
  if (typeof patch.story === 'string' && patch.story !== await read(path.join(dir, 'README.md'), '')) {
    await writeAtomic(path.join(dir, 'README.md'), patch.story)
  }
  if (patch.prompts) data.prompts = patch.prompts
  if ('note' in patch) data.note = patch.note
  if ('tags' in patch) {
    const tags = [...new Set(patch.tags.map(tag => tag.trim()).filter(Boolean))]
    const savedTags = Array.isArray(data.tags) ? data.tags : []
    data.tags = tags.filter(tag => !groups.includes(tag) || savedTags.includes(tag))
    const hiddenGroupTags = groups.filter(tag => !tags.includes(tag))
    if (hiddenGroupTags.length) data.hiddenGroupTags = hiddenGroupTags
    else delete data.hiddenGroupTags
  }
  if ('mainImage' in patch) data.mainImage = patch.mainImage
  data.name = name
  data.tags ??= []
  await writeIndex(dir, data)
  if (next !== dir) await fs.rename(dir, next)
  return detail(next, groups)
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 81 * 1024 * 1024) throw fail(413, '素材过大，单次上传上限为 60 MB')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks))
  } catch {
    throw fail(400, '请求格式无效')
  }
}

export function characterAssets() {
  let mutations = Promise.resolve()
  return {
    name: 'character-assets',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const request = new URL(req.url, 'http://localhost')
        if (!['/api/characters', '/character-media'].includes(request.pathname)) return next()
        try {
          if (req.method === 'GET') await mutations
          if (request.pathname === '/character-media' && req.method === 'GET') {
            const file = path.resolve(root, request.searchParams.get('file') || '')
            const real = await fs.realpath(file).catch(() => '')
            const mime = types[extension(file)]
            if (!inside(root, file) || real !== file || !mime || !(await fs.stat(file)).isFile()) throw fail(404, '素材不存在')
            res.setHeader('Content-Type', mime)
            res.setHeader('Cache-Control', 'no-cache')
            createReadStream(file).on('error', () => res.destroy()).pipe(res)
            return
          }
          const id = request.searchParams.get('id')
          let result
          if (req.method === 'GET') {
            if (id) {
              const asset = await getDirectory(id)
              result = await detail(asset.dir, asset.groups)
            } else {
              result = await list()
            }
          } else if (request.pathname === '/api/characters' && ['POST', 'PATCH', 'DELETE'].includes(req.method)) {
            if (req.headers['x-workbench'] !== 'local') throw fail(403, '请求来源无效')
            const patch = req.method === 'DELETE' ? null : await body(req)
            const operation = mutations.then(async () => {
              if (req.method === 'DELETE') {
                const asset = await getDirectory(id)
                return deleteAssetDirectory(root, asset.dir)
              }
              if (req.method === 'PATCH') {
                const asset = await getDirectory(id)
                return update(asset.dir, patch, asset.groups)
              }
              const name = nameOf(patch.name)
              const dir = path.join(root, name)
              await ensureAvailable(dir)
              await fs.mkdir(dir)
              await fs.mkdir(path.join(dir, 'archive'))
              await fs.mkdir(path.join(dir, 'voice'))
              await fs.mkdir(path.join(dir, 'portraits'))
              await fs.mkdir(path.join(dir, 'skin'))
              await writeAtomic(path.join(dir, 'README.md'), '')
              await writeIndex(dir, { name, tags: [], history: [] })
              return detail(dir)
            })
            mutations = operation.catch(() => {})
            result = await operation
          } else {
            throw fail(405, '请求方法不支持')
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(result))
        } catch (error) {
          res.statusCode = error.status || 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}
