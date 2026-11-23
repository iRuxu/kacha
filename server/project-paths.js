import path from 'node:path'

export const projectRoot = path.resolve(process.env.KACHA_PROJECT_ROOT || process.cwd())
export const assetRoot = kind => path.join(projectRoot, 'assets', kind)
