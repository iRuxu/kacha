import { reactive } from 'vue'
import { Marked, Renderer } from 'marked'
import DOMPurify from 'dompurify'

export const projectFileUrl = file => '/api/settings?file=' + encodeURIComponent(file)

const imageVersions = reactive(new Map())
for (const kind of ['characters', 'scenes', 'props', 'other', 'settings', 'scripts', 'storyboard']) {
  import.meta.hot?.on('workbench:' + kind + ':changed', ({ files = [] }) => {
    for (const file of files) {
      if (/\.(png|jpe?g|webp|gif|avif)$/i.test(file)) imageVersions.set(file, Date.now())
    }
  })
}

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
        const file = decodeURIComponent(resource.pathname.slice(1))
        const version = token.type === 'image' && imageVersions.get(file)
        token.href = projectFileUrl(file) + (version ? '&modified=' + version : '') + resource.hash
      } catch {
        token.href = '#'
      }
    },
  })
  return DOMPurify.sanitize(parser.parse(markdown), sanitizeOptions)
}
