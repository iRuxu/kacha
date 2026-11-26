import brand from 'virtual:project-brand'

const key = 'kacha:last-work:' + brand.name

export function rememberWork(name, query, labels) {
  try {
    localStorage.setItem(key, JSON.stringify({ name, query, labels, selected: true }))
  } catch { /* Storage can be disabled by the browser. */ }
}

export function recentWork() {
  try {
    const item = JSON.parse(localStorage.getItem(key))
    if (!item?.selected && !item?.query?.group && !(item?.query?.file && item.query.file !== 'index.md')) return null
    if (['scripts', 'storyboard'].includes(item?.name) && Array.isArray(item.labels)) return item
  } catch { /* An unreadable entry is ignored. */ }
  return null
}
