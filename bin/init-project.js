import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const templateRoot = fileURLToPath(new URL('../templates/project/', import.meta.url))

const gitignore = `node_modules/
.DS_Store

# 资产历史版本
archive/

# 视频素材
*.[mM][pP]4
*.[mM][oO][vV]
*.[mM]4[vV]
*.[wW][eE][bB][mM]
*.[mM][kK][vV]
*.[aA][vV][iI]
*.[mM][pP][gG]
*.[mM][pP][eE][gG]
*.[wW][mM][vV]
*.[fF][lL][vV]
*.[mM][xX][fF]
*.3[gG][pP]
*.3[gG]2
*.[oO][gG][vV]
*.[mM][tT][sS]
*.[mM]2[tT][sS]
*.[vV][oO][bB]
*.[rR][mM]
*.[rR][mM][vV][bB]
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
}
