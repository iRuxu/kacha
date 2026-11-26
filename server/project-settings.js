import * as fs from 'node:fs/promises'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { projectRoot } from './project-paths.js'

const root = projectRoot
async function listDocuments() {
  const documents = []
  for (const [folder, group] of [['story', '故事设定'], ['art', '美术设定'], ['other', '其它设定']]) {
    const directory = path.join(root, 'docs', folder)
    if (await fs.realpath(directory).catch(() => '') !== directory) continue
    const entries = await fs.readdir(directory, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue
      const file = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      documents.push({ group, title: path.parse(entry.name).name, file })
    }
  }
  return documents.sort((a, b) => a.group === b.group ? a.file.localeCompare(b.file, 'zh') : 0)
}

const types = { '.markdown': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' }

export function projectSettings() {
  return {
    name: 'workbench-project-settings',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/api/settings') return next()
        if (req.method !== 'GET' && !(req.method === 'PUT' && url.searchParams.has('file'))) {
          res.statusCode = 405
          return res.end()
        }
        if (!url.searchParams.has('file')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.end(JSON.stringify(await listDocuments()))
        }
        const requested = url.searchParams.get('file')
        const allowedRoot = requested.split('/')[0]
        const file = path.resolve(root, requested)
        const type = types[path.extname(file).toLowerCase()]
        const base = path.resolve(root, allowedRoot)
        if (!['docs', 'assets', 'scripts', 'storyboard'].includes(allowedRoot)
          || !file.startsWith(base + path.sep) || !type || await fs.realpath(file).catch(() => '') !== file) {
          res.statusCode = 404
          return res.end('找不到项目文档或参考图')
        }
        try {
          if (req.method === 'PUT') {
            if (!(await listDocuments()).some(document => document.file === requested)) {
              res.statusCode = 404
              return res.end('找不到设定文档')
            }
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const patch = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (typeof patch?.markdown !== 'string' || typeof patch.original !== 'string') {
              res.statusCode = 400
              return res.end('保存内容无效')
            }
            if (readFileSync(file, 'utf8') !== patch.original) {
              res.statusCode = 409
              return res.end('文档已在其他位置修改，请保留草稿并重新载入。')
            }
            const temporary = file + '.' + randomUUID() + '.tmp'
            try {
              writeFileSync(temporary, patch.markdown, { flag: 'wx' })
              renameSync(temporary, file)
            } finally {
              rmSync(temporary, { force: true })
            }
            res.statusCode = 204
            return res.end()
          }
          const data = await fs.readFile(file)
          res.setHeader('Content-Type', type)
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(data)
        } catch (cause) {
          res.statusCode = cause.code === 'ENOENT' ? 404 : 500
          res.end('无法读取项目文件')
        }
      })
    },
  }
}
