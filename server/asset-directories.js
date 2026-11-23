import * as fs from 'node:fs/promises'
import path from 'node:path'

const reserved = new Set(['archive', 'images', 'tracks', 'voice', 'portraits', 'skin', 'skins', '特写', '音色参考', '生成记录'])

export const assetId = (root, dir) => path.relative(root, dir).split(path.sep).join('/')
export const isAssetFolderName = name => !name.startsWith('.') && !reserved.has(name)

export async function deleteAssetDirectory(root, dir) {
  const library = path.resolve(root)
  const target = path.resolve(dir)
  const [realLibrary, realTarget, stat] = await Promise.all([
    fs.realpath(library),
    fs.realpath(target),
    fs.lstat(target),
  ])
  if (!target.startsWith(library + path.sep) || realLibrary !== library || realTarget !== target || !stat.isDirectory()) {
    throw Object.assign(new Error('资产目录不在当前资产库内'), { status: 400 })
  }

  const group = await fs.lstat(path.join(target, 'group.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (group) throw Object.assign(new Error('请选择具体资产，不能删除分组目录'), { status: 400 })

  await fs.rm(target, { recursive: true })
  return { deleted: true }
}

async function entries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export async function scanAssets(root, isAssetMarker = () => false) {
  async function walk(dir, groups, allowEmpty) {
    const assets = []
    let hasGroups = false
    for (const item of await entries(dir)) {
      if (!item.isDirectory() || !isAssetFolderName(item.name)) continue
      const child = path.join(dir, item.name)
      const files = (await entries(child)).filter(entry => entry.isFile())
      const has = name => files.some(entry => entry.name === name)
      const indexed = has('index.json') || files.some(file => isAssetMarker(file.name))
      const group = !indexed && (has('group.json') || /^\d+-/.test(item.name))
      const asset = { dir: child, id: assetId(root, child), groups }
      if (!group && (indexed || has('README.md'))) {
        assets.push(asset)
        continue
      }
      const nested = await walk(child, [...groups, item.name.replace(/^\d+-/, '')], group)
      if (nested.assets.length || nested.hasGroups || group) {
        assets.push(...nested.assets)
        hasGroups = true
      } else if (allowEmpty) assets.push(asset)
    }
    return { assets, hasGroups }
  }
  return (await walk(path.resolve(root), [], true)).assets
}
