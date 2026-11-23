#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { initProject } from './init-project.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      port: { type: 'string', short: 'p', default: '24074' },
    },
  })
  if (values.help) {
    console.log('Usage: kacha [project-directory] [--port 24074]\n       kacha init')
  } else if (positionals[0] === 'init' && positionals.length === 1) {
    await initProject(process.cwd())
    console.log('Kacha project initialized in ' + process.cwd())
  } else {
    if (positionals.length > 1) throw new Error('Pass at most one project directory.')
    const port = Number(values.port)
    if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Port must be an integer from 1 to 65535.')
    }
    const projectRoot = resolve(positionals[0] ?? '.')
    if (!(await stat(projectRoot)).isDirectory()) throw new Error('The project path must be a directory.')

    process.env.KACHA_PROJECT_ROOT = projectRoot
    const { createServer } = await import('vite')
    const server = await createServer({
      root: packageRoot,
      configFile: resolve(packageRoot, 'vite.config.js'),
      cacheDir: resolve(projectRoot, 'node_modules/.vite-kacha'),
      server: { port },
    })
    try {
      await server.listen()
      server.printUrls()
    } catch (error) {
      await server.close()
      throw error
    }
  }
} catch (error) {
  console.error('kacha: ' + error.message)
  process.exitCode = 1
}
