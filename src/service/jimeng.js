import projectGlobal from 'virtual:project-global'

export function jimengSyncUrl(kind, assets, instruction) {
  const paths = assets.map(({ id }) => 'assets/' + kind + '/' + id.split('\\').join('/'))
  const prompt = [instruction, '资产路径（相对于项目根目录）：', ...paths].join('\n')
  const params = new URLSearchParams({ mode: 'codex', path: projectGlobal.projectRoot, prompt })
  return 'codex://threads/new?' + params
}
