export async function requestAsset(kind, id, method = 'GET', data) {
  const query = id ? '?id=' + encodeURIComponent(id) : ''
  const response = await fetch('/api/' + kind + query, {
    method,
    ...(data ? {
      headers: { 'Content-Type': 'application/json', 'X-Workbench': 'local' },
      body: JSON.stringify(data),
    } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}
