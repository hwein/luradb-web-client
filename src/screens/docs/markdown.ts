import { marked } from 'marked'

marked.use({
  renderer: {
    link({ href, text }) {
      if (href.startsWith('docs:')) {
        const id = href.slice('docs:'.length)
        return `<a href="#" class="docs-article__link" data-docs-link="${id}">${text}</a>`
      }
      // Artikel sind gebündelt, keine externen Links (spec docs/001 §4).
      return text
    },
    image() {
      return ''
    },
  },
})

/** Eingeschränktes Markdown-Set (Headings/Absätze/Listen/Code/interne Links) — spec docs/001 §4. */
export function renderArticleBody(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}
