import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const templateRoot = fileURLToPath(new URL('../templates/project/', import.meta.url))

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
    // npm omits .env and .gitignore, so restore their names during initialization.
    const outputName = source === templateRoot
      ? ({ 'env.template': '.env', 'gitignore.template': '.gitignore' }[entry.name] || entry.name)
      : entry.name
    const to = join(destination, outputName)
    if (entry.isDirectory()) {
      await keepExisting(() => mkdir(to))
      if (!(await lstat(to)).isDirectory()) {
        throw new Error(`Expected a directory at ${to}`)
      }
      await copyTemplates(from, to)
    } else if (source === templateRoot && ['.env', '.lfsconfig'].includes(outputName)) {
      let content = await readFile(from, 'utf8')
      if (entry.name === '.lfsconfig') {
        const projectName = encodeURIComponent(basename(destination) || 'project')
        content = content.replace('{{projectName}}', () => projectName)
      }
      await keepExisting(() => writeFile(to, content, { flag: 'wx', mode: outputName === '.env' ? 0o600 : 0o666 }))
    } else {
      await keepExisting(() => copyFile(from, to, constants.COPYFILE_EXCL))
    }
  }
}

export async function initProject(projectRoot) {
  await copyTemplates(templateRoot, projectRoot)
}
