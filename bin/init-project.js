import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const templateRoot = fileURLToPath(new URL('../templates/project/', import.meta.url))

const gitignore = `.DS_Store
tmp/
node_modules/
.env
.env.*
.kacha/oss-sync/
.kacha/lfs-transfer/
`

const envTemplate = `OSS_ENDPOINT=
OSS_BUCKET=
OSS_PREFIX=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
`

async function keepExisting(operation) {
  try {
    await operation()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

async function copyTemplates(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      await keepExisting(() => mkdir(to))
      if (!(await lstat(to)).isDirectory()) {
        throw new Error(`Expected a directory at ${to}`)
      }
      await copyTemplates(from, to)
    } else {
      await keepExisting(() => copyFile(from, to, constants.COPYFILE_EXCL))
    }
  }
}

export async function initProject(projectRoot) {
  await copyTemplates(templateRoot, projectRoot)
  await keepExisting(() => writeFile(join(projectRoot, '.gitignore'), gitignore, { flag: 'wx' }))
  await keepExisting(() => writeFile(join(projectRoot, '.env'), envTemplate, { flag: 'wx', mode: 0o600 }))
  const projectName = encodeURIComponent(basename(projectRoot) || 'project')
  const lfsConfig = `[lfs]\n\turl = https://kacha-lfs.invalid/${projectName}\n`
  await keepExisting(() => writeFile(join(projectRoot, '.lfsconfig'), lfsConfig, { flag: 'wx' }))
}
