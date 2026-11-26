import * as fs from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assetRoot } from './project-paths.js'
import { assetId, deleteAssetDirectory, isAssetFolderName, scanAssets } from './asset-directories.js'

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' }
const audioTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac' }
const audioGroups = { music: '音乐', effect: '音效', dialogue: '台词' }
const otherGroups = { graphic: '图形与字标', effect: '特效', delivery: '交付版' }
const otherFolders = { graphic: 'extend' }
const sceneGroups = { view: '机位', season: '季节', time: '时间', weather: '天气', layout: '空间定位', detail: '局部与陈设' }
const sceneFolders = { view: 'views', season: 'seasons', time: 'time', weather: 'weather', layout: 'layout', detail: 'details' }
const propGroups = { angle: '角度', portrait: '特写' }
const propFolders = { angle: 'angles', portrait: 'portraits' }
const legacyPropTypes = { object: '实体道具', wearable: '穿戴与配饰', graphic: '标识与字标' }
const statuses = { adopted: '已采用', candidate: '候选', reference: '参考' }
const error = (status, message) => Object.assign(new Error(message), { status })
const sort = (a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })

async function read(file, fallback = '') {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (cause) {
    if (cause.code === 'ENOENT') return fallback
    throw cause
  }
}

async function entries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (cause) {
    if (cause.code === 'ENOENT') return []
    throw cause
  }
}

async function localFile(base, name) {
  if (typeof name !== 'string') return null
  const file = path.resolve(base, name)
  if (!file.startsWith(base + path.sep) || await fs.realpath(file).catch(() => null) !== file) return null
  return (await fs.stat(file)).isFile() ? file : null
}

const mediaUrl = (file, library) => library.mediaPath + '?file=' + encodeURIComponent(path.relative(library.root, file))
const meta = async dir => JSON.parse(await read(path.join(dir, 'index.json'), '{}'))

async function picture(dir, entry, includePrompt, library) {
  const file = await localFile(dir, entry.file)
  const result = {
    ...entry,
    url: file ? mediaUrl(file, library) + '&modified=' + (await fs.stat(file)).mtimeMs : null,
  }
  if (includePrompt && !Object.hasOwn(entry, 'prompt') && entry.promptRecord) {
    const recordPath = await localFile(dir, entry.promptRecord)
    if (recordPath) {
      const record = JSON.parse(await read(recordPath))
      const item = (entry.promptEntry || []).reduce((value, key) => value?.[key], record)
      result.prompt = typeof item?.prompt === 'string' ? item.prompt : item?.prompt?.text
    }
  }
  return result
}

async function imagePaths(dir, formats, prefix = '') {
  const files = []
  for (const item of await entries(path.join(dir, prefix))) {
    const relative = path.join(prefix, item.name)
    if (item.name.startsWith('.') || item.name === '生成记录' || item.name === 'archive') continue
    if (item.isDirectory()) files.push(...await imagePaths(dir, formats, relative))
    if (item.isFile() && formats[path.extname(item.name).toLowerCase()]) files.push(relative)
  }
  return files.sort(sort)
}

function savedPropTags(data) {
  if (Array.isArray(data.tags)) return data.tags.filter(tag => typeof tag === 'string')
  return Object.hasOwn(legacyPropTypes, data.propType) ? [legacyPropTypes[data.propType]] : []
}

function normalizeTags(tags) {
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw error(400, '标签必须是文本数组')
  }
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]
}

const isRootCover = file => /^index\.(png|jpe?g|webp|avif)$/i.test(file)
const savedAssetTags = data => Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === 'string') : []
const retainedImageFiles = data => Array.isArray(data.retainedImages) ? data.retainedImages : []

function propCategory(image) {
  if (image.file?.startsWith(propFolders.angle + '/')) return 'angle'
  if (image.file?.startsWith(propFolders.portrait + '/')) return 'portrait'
  return ['view', 'angle'].includes(image.category) ? 'angle' : 'portrait'
}

async function folderImages(dir, data, library) {
  const indexedImages = Array.isArray(data.images) ? data.images : []
  const images = library.isProp
    ? indexedImages.map(image => ({ ...image, category: propCategory(image) }))
    : indexedImages
  const registered = new Set([...images.map(image => image.file), ...retainedImageFiles(data)])
  const ids = new Set(images.map(image => image.id))
  const rootImages = (await entries(dir)).filter(file => file.isFile() && isRootCover(file.name)).map(file => file.name).sort(sort)
  const current = images.find(image => image.id === data.mainImage)
  const coverFile = rootImages.includes(current?.file) ? current.file : rootImages[0]
  const discovered = (file, category, label) => {
    let id = file
    for (let sequence = 2; ids.has(id); sequence++) id = file + '#' + sequence
    ids.add(id)
    return { id, file, label, category, status: 'reference' }
  }
  const inPropGallery = library.isProp && Object.values(propFolders).some(folder => current?.file?.startsWith(folder + '/'))
  const cover = coverFile
    ? images.find(image => image.file === coverFile) || discovered(coverFile, library.defaultCategory, '主图')
    : inPropGallery ? undefined : current
  const variants = await Promise.all(Object.entries(library.galleryFolders).map(async ([category, folder]) => {
    const location = path.join(dir, folder)
    if (await fs.realpath(location).catch(() => null) !== location) return []
    return (await imagePaths(dir, types, folder)).filter(file => !registered.has(file))
      .map(file => ({ file, category }))
  }))
  const items = images.filter(image => !isRootCover(image.file) || image === cover)
  if (cover && !items.includes(cover)) items.unshift(cover)
  return {
    items: [...items, ...variants.flatMap(group => group.map(({ file, category }) => discovered(file, category, path.parse(file).name)))],
    cover,
  }
}

function assetTags(data, groupPath, defaults) {
  const hidden = Array.isArray(data.hiddenGroupTags) ? data.hiddenGroupTags : []
  return [...new Set([...defaults, ...groupPath.filter(tag => !hidden.includes(tag))])]
}

function saveTags(data, tags, groups, defaults) {
  data.tags = tags.filter(tag => !groups.includes(tag) || defaults.includes(tag))
  const hidden = groups.filter(tag => !tags.includes(tag))
  if (hidden.length) data.hiddenGroupTags = hidden
  else delete data.hiddenGroupTags
}

async function describe(dir, full, library, groupPath = []) {
  const data = await meta(dir)
  const { items: images, cover } = !library.isAudio ? await folderImages(dir, data, library) : {
    items: Array.isArray(data[library.entriesKey]) ? data[library.entriesKey] : [],
    cover: data[library.entriesKey]?.find(image => image.id === data[library.mainKey]),
  }
  const result = {
    id: assetId(library.root, dir),
    groupPath,
    name: data.name || path.basename(dir),
    count: images.length,
    ...(library.isAudio ? {
      type: data.type || '',
      categories: data.type ? [data.type] : [...new Set(images.map(item => item.category))],
    } : {}),
    cover: cover ? await picture(dir, cover, full && !library.isAudio, library) : null,
  }
  const saved = library.isProp ? savedPropTags(data) : savedAssetTags(data)
  result.tags = library.isAudio ? saved : assetTags(data, groupPath, saved)
  if (full) result.note = typeof data.note === 'string' ? data.note : ''
  if (library.isProp) result.transparentPreview = data.propType === 'graphic'
  if (!full) return result
  const archive = path.join(dir, 'archive')
  const history = []
  if (await fs.realpath(archive).catch(() => null) === archive) {
    const legacy = []
    for (const item of await entries(archive)) {
      if (item.name.startsWith('.') || item.name === '生成记录') continue
      if (item.isDirectory()) {
        const version = path.join(archive, item.name)
        const previous = await meta(version)
        const files = previous[library.entriesKey] || (await imagePaths(version, library.formats)).map(file => ({ file, label: path.basename(file) }))
        const listed = data.history?.find(entry => entry.version === item.name)
        const directoryDate = /^\d{4}-\d{2}-\d{2}(?=-|$)/.exec(item.name)?.[0]
        history.push({
          version: item.name,
          note: listed?.note,
          images: await Promise.all(files.map(entry => picture(version, entry, true, library))),
          ...(!library.isAudio ? {
            story: await read(path.join(version, 'README.md')),
            createdAt: listed?.archivedAt || directoryDate || (await fs.stat(version)).birthtime.toISOString(),
            timeSource: listed?.archivedAt || directoryDate ? 'archive' : 'directory',
          } : {}),
        })
      } else if (item.isFile() && library.formats[path.extname(item.name).toLowerCase()]) {
        legacy.push(await picture(archive, { file: item.name, label: item.name }, false, library))
      }
    }
    if (legacy.length) {
      history.push({
        version: '早期归档',
        images: legacy,
        ...(!library.isAudio ? {
          createdAt: (await fs.stat(archive)).birthtime.toISOString(),
          timeSource: 'directory',
        } : {}),
      })
    }
  }
  return {
    ...result, groups: library.groups, statuses,
    story: await read(path.join(dir, 'README.md')),
    images: await Promise.all(images.map(entry => picture(dir, entry, true, library))),
    history: history.sort((a, b) => sort(b.version, a.version)),
  }
}

function newAssetDirectory(name, library) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || !isAssetFolderName(name) || /[/\\:\u0000-\u001f]/.test(name)) {
    throw error(400, library.label + '名称无效')
  }
  return path.join(library.root, name)
}

async function existingAsset(id, library) {
  const asset = (await scanAssets(library.root, library.isAudio ? undefined : isRootCover)).find(entry => entry.id === id)
  if (!asset) throw error(404, '找不到' + library.label + '目录')
  return asset
}

async function write(file, content) {
  const temp = path.join(path.dirname(file), '.' + randomUUID() + '.tmp')
  try {
    await fs.writeFile(temp, content)
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
const writeIndex = (dir, data) => write(path.join(dir, 'index.json'), JSON.stringify(data, null, 2) + '\n')

async function savePrevious(dir, data, library, { image, file: previous, story, note }) {
  const archive = path.join(dir, 'archive')
  await fs.mkdir(archive, { recursive: true })
  if (await fs.realpath(archive) !== archive) throw error(400, '归档目录必须位于' + library.label + '目录内')
  const versions = await entries(archive)
  const number = Math.max(0, ...versions.map(item => Number(/^\d{4}-\d{2}-\d{2}-v(\d+)$/.exec(item.name)?.[1] || 0))) + 1
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const version = date + '-v' + String(number).padStart(3, '0')
  const draft = path.join(archive, '.' + randomUUID())
  await fs.mkdir(draft)
  try {
    const items = []
    if (previous) {
      const file = path.basename(previous)
      await fs.copyFile(previous, path.join(draft, file))
      const { url, promptRecord, promptEntry, ...saved } = await picture(dir, image, true, library)
      items.push({ ...saved, file })
    }
    if (typeof story === 'string') await write(path.join(draft, 'README.md'), story)
    await writeIndex(draft, { [library.entriesKey]: items })
    await fs.rename(draft, path.join(archive, version))
  } finally {
    await fs.rm(draft, { recursive: true, force: true })
  }
  data.history = [...(data.history || []), { version, note, ...(!library.isAudio ? { archivedAt: new Date().toISOString() } : {}) }]
  return path.join(archive, version)
}

function sceneConditions(conditions) {
  return Object.fromEntries(['season', 'time', 'weather']
    .filter(key => typeof conditions?.[key] === 'string' && conditions[key].trim())
    .map(key => [key, conditions[key].trim()]))
}

function readUpload(upload, library) {
  const { filename, base64, category, status, label, prompt, conditions } = upload
  const ext = typeof filename === 'string' && path.extname(filename).toLowerCase()
  if (!Object.hasOwn(library.formats, ext) || !Object.hasOwn(library.groups, category) || !Object.hasOwn(statuses, status)
    || typeof label !== 'string' || !label.trim() || typeof prompt !== 'string' || typeof base64 !== 'string') {
    throw error(400, '请填写素材名称、分类、状态并选择支持的文件')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw error(400, '请选择 30 MB 以内的文件')
  const variants = sceneConditions(conditions)
  return {
    ext, bytes,
    fields: { label: label.trim(), category, status, prompt, ...(Object.keys(variants).length ? { conditions: variants } : {}) },
  }
}

async function fileExists(file) {
  return Boolean(await fs.lstat(file).catch(cause => {
    if (cause.code !== 'ENOENT') throw cause
    return null
  }))
}

async function galleryFile(dir, category, label, ext, library) {
  const folders = library.galleryFolders
  const folder = Object.hasOwn(folders, category) ? folders[category] : folders[library.defaultCategory]
  const location = path.join(dir, folder)
  await fs.mkdir(location, { recursive: true })
  if (await fs.realpath(location) !== location) throw error(400, '素材目录必须位于' + library.label + '目录内')
  const stem = [...label.replace(/[/\\:\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim()].slice(0, 50).join('') || library.label + '图'
  let file = folder + '/' + stem + ext
  for (let sequence = 2; await fileExists(path.join(dir, file)); sequence++) {
    file = folder + '/' + stem + '-' + sequence + ext
  }
  return file
}

async function updateImageFields(dir, data, image, file, changes, library) {
  const { label = image?.label, category = image?.category, status = image?.status, prompt } = changes
  if (!file || typeof label !== 'string' || !label.trim() || category !== image.category
    || !Object.hasOwn(statuses, status) || typeof prompt !== 'string') {
    throw error(400, '请填写有效的素材名称、状态和生成词')
  }
  const previous = await picture(dir, image, true, library)
  const promptChanged = prompt !== (previous.prompt || '')
  const archive = promptChanged && previous.prompt && await savePrevious(dir, data, library, {
    image, file, note: '修改「' + image.label + '」生成词',
  })
  try {
    image.label = label.trim()
    image.status = status
    if (Object.hasOwn(changes, 'conditions')) {
      const conditions = sceneConditions(changes.conditions)
      if (Object.keys(conditions).length) image.conditions = conditions
      else delete image.conditions
    }
    if (promptChanged) {
      image.prompt = prompt
      delete image.promptRecord
      delete image.promptEntry
    }
    await writeIndex(dir, data)
  } catch (cause) {
    if (archive) await fs.rm(archive, { recursive: true, force: true })
    throw cause
  }
}

async function updateFolderMedia(dir, data, patch, library) {
  const { items, cover } = await folderImages(dir, data, library)
  data.images = items
  data.mainImage = cover?.id || null
  const upload = patch.image
  if (library.isProp && !upload) throw error(400, '请在主图页签单独上传主图')
  const old = items.find(image => image.id === (upload?.id || patch.mainImage))
  const before = old && await localFile(dir, old.file)
  if (upload?.id && !old) throw error(404, '找不到要替换的素材')

  if (upload && !Object.hasOwn(upload, 'base64')) {
    return updateImageFields(dir, data, old, before, upload, library)
  }

  if (!upload && !before) throw error(400, '请选择存在的图片')
  if (!upload && old === cover && isRootCover(old.file)) return

  const promotion = !upload
  if (library.isProp && old && (old === cover) !== (upload.main === true)) {
    throw error(400, '请在对应页签替换图片')
  }
  if (upload?.main && old && cover && old !== cover) throw error(400, '请先设置主图，再替换图片')
  const main = promotion || upload.main === true || (old && old === cover) || (!library.isProp && !cover && upload.main !== false)
  const { ext, fields, bytes } = promotion
    ? { ext: path.extname(before).toLowerCase(), fields: old, bytes: await fs.readFile(before) }
    : readUpload(upload, library)
  if (!Object.hasOwn(library.formats, ext)) throw error(400, '图片格式不受支持')
  const previous = promotion ? cover : old || (main ? cover : null)
  const previousFile = previous && await localFile(dir, previous.file)
  const previousCover = previousFile && isRootCover(previous.file)
  const sameFormat = previousCover && path.extname(previous.file).toLowerCase() === ext
  const file = main ? (sameFormat ? previous.file : 'index' + ext) : await galleryFile(dir, fields.category, fields.label, ext, library)
  const target = path.join(dir, file)
  if (!sameFormat && await fileExists(target)) throw error(409, '已有同名主图，请先整理' + library.label + '目录')

  const note = promotion ? '变更主图' : '替换「' + previous?.label + '」'
  let archive
  let demotedFile
  let wroteTarget = false
  let removedPrevious = false
  try {
    if (previousFile) archive = await savePrevious(dir, data, library, { image: previous, file: previousFile, note })
    if (promotion && previousCover && previous !== old) {
      const variant = await galleryFile(dir, previous.category, previous.label, path.extname(previous.file), library)
      await fs.copyFile(previousFile, path.join(dir, variant), constants.COPYFILE_EXCL)
      demotedFile = variant
      previous.file = demotedFile
    }
    await write(target, bytes)
    wroteTarget = true
    if (previousCover && previousFile !== target) {
      await fs.unlink(previousFile)
      removedPrevious = true
    }

    const replaced = promotion ? old : previous
    if (replaced && !isRootCover(replaced.file)) {
      data.retainedImages = [...new Set([...retainedImageFiles(data), replaced.file])]
    }
    const entry = { id: replaced?.id || randomUUID(), ...fields, file }
    data.images = replaced ? items.map(image => image === replaced ? entry : image) : [...items, entry]
    if (main) data.mainImage = entry.id
    await writeIndex(dir, data)
  } catch (cause) {
    if (wroteTarget) await fs.rm(target, { force: true })
    if (removedPrevious || (wroteTarget && sameFormat)) {
      await fs.copyFile(path.join(archive, path.basename(previousFile)), previousFile)
    }
    if (demotedFile) await fs.rm(path.join(dir, demotedFile), { force: true })
    if (archive) await fs.rm(archive, { recursive: true, force: true })
    throw cause
  }
}

async function updateImageAssetMetadata(dir, data, patch, library, groups) {
  if (typeof patch.story === 'string') {
    const file = path.join(dir, 'README.md')
    const oldStory = await read(file, null)
    if (patch.story === (oldStory || '')) return
    const archive = oldStory && await savePrevious(dir, data, library, { story: oldStory, note: '修改' + library.label + '说明' })
    try {
      await write(file, patch.story)
      if (archive) await writeIndex(dir, data)
    } catch (cause) {
      if (archive) {
        await write(file, oldStory)
        await fs.rm(archive, { recursive: true, force: true })
      }
      throw cause
    }
  } else if (['name', 'tags', 'note'].some(key => Object.hasOwn(patch, key))
    || (library.isAudio && Object.hasOwn(patch, 'type'))) {
    if (library.isAudio && Object.hasOwn(patch, 'type')) {
      if (patch.type !== '' && !Object.hasOwn(library.groups, patch.type)) throw error(400, '请选择有效的音频类型')
      if (patch.type) data.type = patch.type
      else delete data.type
    }
    if (Object.hasOwn(patch, 'name')) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name) throw error(400, '请输入' + library.label + '名称')
      data.name = name
    }
    if (Object.hasOwn(patch, 'note')) {
      if (typeof patch.note !== 'string') throw error(400, '备注必须是文本')
      data.note = patch.note
    }
    if (Object.hasOwn(patch, 'tags')) {
      const saved = library.isProp ? savedPropTags(data) : savedAssetTags(data)
      const tags = normalizeTags(patch.tags)
      if (library.isAudio) data.tags = tags
      else saveTags(data, tags, groups, saved)
    }
    await writeIndex(dir, data)
  } else {
    throw error(400, '没有可保存的内容')
  }
}

async function update(dir, patch, library, groups) {
  const data = await meta(dir)
  if (!library.isAudio) {
    if (patch.image || typeof patch.mainImage === 'string') {
      await updateFolderMedia(dir, data, patch, library)
    } else {
      await updateImageAssetMetadata(dir, data, patch, library, groups)
    }
    return describe(dir, true, library, groups)
  }
  const items = data[library.entriesKey] ??= []
  const upload = patch.track
  if (upload) {
    const { id } = upload
    const old = items.find(entry => entry.id === id)
    if (id && !old) throw error(404, '找不到要替换的素材')
    const previous = old && await localFile(dir, old.file)
    const { ext, bytes, fields } = readUpload(library.isAudio && data.type ? { ...upload, category: data.type } : upload, library)
    const imageId = old?.id || randomUUID()
    const mediaDir = path.join(dir, library.mediaFolder)
    await fs.mkdir(mediaDir, { recursive: true })
    if (await fs.realpath(mediaDir) !== mediaDir) throw error(400, '素材目录必须位于' + library.label + '目录内')
    const file = library.mediaFolder + '/' + randomUUID() + ext
    await write(path.join(dir, file), bytes)
    let archive
    try {
      if (previous) archive = await savePrevious(dir, data, library, { image: old, file: previous, note: '替换「' + old.label + '」' })
      const entry = {
        id: imageId, file, ...fields,
        source: typeof upload.source === 'string' ? upload.source.trim() : '',
        usage: typeof upload.usage === 'string' ? upload.usage.trim() : '',
        loop: upload.loop === true,
      }
      data[library.entriesKey] = old ? items.map(image => image === old ? entry : image) : [...items, entry]
      data[library.mainKey] ||= imageId
      await writeIndex(dir, data)
    } catch (cause) {
      await fs.rm(path.join(dir, file), { force: true })
      if (archive) await fs.rm(archive, { recursive: true, force: true })
      throw cause
    }
  } else if (typeof patch.mainImage === 'string') {
    const selected = items.find(image => image.id === patch.mainImage)
    if (!selected || !await localFile(dir, selected.file)) throw error(400, '请选择存在的图片')
    data[library.mainKey] = selected.id
    await writeIndex(dir, data)
  } else if (typeof patch.story === 'string') {
    await write(path.join(dir, 'README.md'), patch.story)
  } else {
    await updateImageAssetMetadata(dir, data, patch, library, groups)
  }
  return describe(dir, true, library, groups)
}

async function readBody(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 41 * 1024 * 1024) throw error(413, '文件大小超过 30 MB')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks))
  } catch {
    throw error(400, '请求格式无效')
  }
}

export async function streamMedia(file, req, res) {
  const { size } = await fs.stat(file)
  res.setHeader('Accept-Ranges', 'bytes')
  const range = req.headers.range
  if (!range) {
    res.setHeader('Content-Length', size)
    return createReadStream(file).on('error', () => res.destroy()).pipe(res)
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const start = match?.[1] ? Number(match[1]) : Math.max(size - Number(match?.[2]), 0)
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    res.statusCode = 416
    res.setHeader('Content-Range', 'bytes */' + size)
    return res.end()
  }
  res.statusCode = 206
  res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size)
  res.setHeader('Content-Length', end - start + 1)
  return createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
}

export function imageAssets(kind) {
  const isProp = kind === 'props'
  const isAudio = kind === 'audio'
  const library = {
    isProp, isAudio,
    entriesKey: isAudio ? 'tracks' : 'images',
    mainKey: isAudio ? 'mainTrack' : 'mainImage',
    mediaFolder: isAudio ? 'tracks' : 'images',
    galleryFolders: ({ props: propFolders, scenes: sceneFolders, other: otherFolders })[kind],
    defaultCategory: ({ props: 'angle', scenes: 'view', other: 'graphic' })[kind],
    formats: isAudio ? audioTypes : types,
    root: assetRoot(kind),
    mediaPath: '/' + ({ props: 'prop', scenes: 'scene', audio: 'audio', other: 'other' })[kind] + '-media',
    groups: ({ props: propGroups, scenes: sceneGroups, audio: audioGroups, other: otherGroups })[kind],
    label: ({ props: '道具', scenes: '场景', audio: '音频', other: '其他素材' })[kind],
  }
  const apiPath = '/api/' + kind
  let mutations = Promise.resolve()
  return {
    name: 'workbench-' + kind,
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const request = new URL(req.url, 'http://localhost')
        if (![apiPath, library.mediaPath].includes(request.pathname)) return next()
        try {
          if (req.method === 'GET') await mutations
          if (request.pathname === library.mediaPath) {
            const file = await localFile(library.root, request.searchParams.get('file'))
            const mime = file && library.formats[path.extname(file).toLowerCase()]
            if (req.method !== 'GET' || !mime) throw error(404, '素材不存在')
            res.setHeader('Content-Type', mime)
            res.setHeader('Cache-Control', 'no-cache')
            if (isAudio) {
              await streamMedia(file, req, res)
              return
            }
            createReadStream(file).on('error', () => res.destroy()).pipe(res)
            return
          }
          const id = request.searchParams.get('id')
          let result
          if (req.method === 'GET') {
            if (id) {
              const asset = await existingAsset(id, library)
              result = await describe(asset.dir, true, library, asset.groups)
            } else {
              const assets = await scanAssets(library.root, library.isAudio ? undefined : isRootCover)
              result = await Promise.all(assets.sort((a, b) => sort(a.id, b.id)).map(asset => describe(asset.dir, false, library, asset.groups)))
            }
          } else if (['PATCH', 'POST', 'DELETE'].includes(req.method)) {
            if (req.headers['x-workbench'] !== 'local') throw error(403, '请求来源无效')
            const patch = req.method === 'DELETE' ? null : await readBody(req)
            const operation = mutations.then(async () => {
              if (req.method === 'DELETE') {
                const asset = await existingAsset(id, library)
                return deleteAssetDirectory(library.root, asset.dir)
              }
              if (req.method === 'PATCH') {
                const asset = await existingAsset(id, library)
                return update(asset.dir, patch, library, asset.groups)
              }
              const tags = Object.hasOwn(patch, 'tags') ? normalizeTags(patch.tags) : []
              const audioMetadata = {}
              if (isAudio && Object.hasOwn(patch, 'type')) {
                if (!Object.hasOwn(library.groups, patch.type)) throw error(400, '请选择有效的音频类型')
                audioMetadata.type = patch.type
              }
              if (isAudio && Object.hasOwn(patch, 'note')) {
                if (typeof patch.note !== 'string') throw error(400, '备注必须是文本')
                audioMetadata.note = patch.note
              }
              const dir = newAssetDirectory(patch.name, library)
              await fs.mkdir(dir).catch(cause => {
                if (cause.code === 'EEXIST') throw error(409, '已有同名' + library.label)
                throw cause
              })
              const folders = library.galleryFolders ? Object.values(library.galleryFolders) : [library.mediaFolder]
              await Promise.all(folders.map(folder => fs.mkdir(path.join(dir, folder))))
              await fs.mkdir(path.join(dir, 'archive'))
              await write(path.join(dir, 'README.md'), '')
              await writeIndex(dir, {
                name: patch.name,
                tags,
                ...audioMetadata,
                [library.mainKey]: null, [library.entriesKey]: [], history: [],
              })
              return describe(dir, true, library)
            })
            mutations = operation.catch(() => {})
            result = await operation
          } else {
            throw error(405, '请求方法不支持')
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(result))
        } catch (cause) {
          res.statusCode = cause.status || 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: cause.message }))
        }
      })
    },
  }
}
