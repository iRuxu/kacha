import * as fs from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './project-paths.js'

const root = projectRoot
const documents = [
  { group: '故事设定', title: '世界观与角色', file: 'docs/世界观与角色.md' },
  { group: '美术设定', title: '角色美术', file: 'docs/角色美术设定.md' },
  { group: '美术设定', title: '场景与空间', file: 'assets/scenes/README.md' },
  { group: '美术设定', title: '道具美术', file: 'docs/道具美术设定.md' },
  { group: '生成与制作', title: '3D 电影 CG 风格', file: 'docs/3D电影CG风格与生成工作流.md' },
  { group: '生成与制作', title: '分镜与视频生成', file: 'docs/agents/production-workflow.md' },
  { group: '生成与制作', title: '角色原画与三视图', file: 'docs/角色双版本与3D高清生成规范.md' },
]
const types = { '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' }

export function projectSettings() {
  return {
    name: 'workbench-project-settings',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/api/settings') return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          return res.end()
        }
        if (!url.searchParams.has('file')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.end(JSON.stringify(documents))
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
