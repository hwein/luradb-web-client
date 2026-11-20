import { marked } from 'marked'

marked.use({
  renderer: {
    link({ href, text }) {
      if (href.startsWith('docs:')) {
        const id = href.slice('docs:'.length)
        return `<a href="#" class="docs-article__link" data-docs-link="${id}">${text}</a>`
      }
      // Articles are bundled, so external links are dropped.
      return text
    },
    image() {
      return ''
    },
  },
})

/** Restricted Markdown set: headings, paragraphs, lists, tables, code and internal links. */
export function renderArticleBody(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}
