import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const agent = 'kacha-oss'
const cli = fileURLToPath(new URL('./kacha.js', import.meta.url))

export function findGitProject() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\r?\n$/, '')
  } catch {
    throw new Error('Run this command in a Git working tree.')
  }
}

export function setupLfs(root) {
  const git = (args, stdio = ['ignore', 'pipe', 'ignore']) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio,
  })

  try {
    git(['lfs', 'version'])
  } catch {
    throw new Error('Install Git LFS before configuring the Kacha OSS transfer agent.')
  }

  let existing
  try {
    existing = git(['config', '--local', '--get', 'lfs.standalonetransferagent']).trim()
  } catch (error) {
    if (error.status !== 1) throw error
  }
  if (existing && existing !== agent) {
    throw new Error('This repository already uses another standalone Git LFS transfer agent.')
  }

  if (git(['ls-files', '--', '.env', '.kacha/lfs-transfer/']).trim()) {
    throw new Error('Remove .env and .kacha/lfs-transfer/ from the Git index before configuring the OSS agent.')
  }
  const exclude = git(['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).trimEnd()
  mkdirSync(dirname(exclude), { recursive: true })
  let current = ''
  try {
    current = readFileSync(exclude, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const existingRules = new Set(current.split(/\r?\n/))
  const rules = ['/.env', '/.kacha/lfs-transfer/'].filter(rule => !existingRules.has(rule))
  if (rules.length) appendFileSync(exclude, (current && !current.endsWith('\n') ? '\n' : '') + rules.join('\n') + '\n')

  for (const file of ['.env', '.kacha/lfs-transfer/checkpoint.json']) {
    try {
      git(['check-ignore', '--quiet', '--', file])
    } catch (error) {
      if (error.status !== 1) throw error
      throw new Error('Add a Git ignore rule for ' + file + ' before configuring the OSS agent.')
    }
  }

  // Let Git LFS create its usual hook and report an existing-hook conflict without replacing it.
  git(['lfs', 'install', '--local'], 'inherit')
  const args = '"' + cli.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '" lfs transfer'
  const settings = {
    ['lfs.customtransfer.' + agent + '.path']: process.execPath,
    ['lfs.customtransfer.' + agent + '.args']: args,
    ['lfs.customtransfer.' + agent + '.concurrent']: 'false',
    'lfs.locksverify': 'false',
    'lfs.standalonetransferagent': agent,
  }
  for (const [key, value] of Object.entries(settings)) git(['config', '--local', key, value])
}
