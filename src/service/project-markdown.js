import { Marked, Renderer } from 'marked'
import DOMPurify from 'dompurify'

export const projectFileUrl = file => '/api/settings?file=' + encodeURIComponent(file)

export function renderProjectMarkdown(markdown, file, sanitizeOptions) {
  const local = file ? new URL(file, 'https://project.invalid/') : null
  const parser = new Marked({
    renderer: {
      table(token) {
        return '<div class="markdown-table">' + Renderer.prototype.table.call(this, token) + '</div>\n'
      },
    },
    walkTokens(token) {
      if (!local || !['image', 'link'].includes(token.type) || token.href.startsWith('#')) return
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(token.href)) return
      try {
        const resource = new URL(token.href, local)
        token.href = projectFileUrl(decodeURIComponent(resource.pathname.slice(1))) + resource.hash
      } catch {
        token.href = '#'
      }
    },
  })
  return DOMPurify.sanitize(parser.parse(markdown), sanitizeOptions)
}
