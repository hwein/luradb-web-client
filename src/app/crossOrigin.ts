const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function parse(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

export function isCrossOrigin(pageOrigin: string, targetUrl: string): boolean {
  const page = parse(pageOrigin)
  const target = parse(targetUrl)
  if (page === undefined || target === undefined) return false
  return page.origin !== target.origin
}

/** Browsers block an https page from calling plain http, except on loopback (treated as potentially trustworthy). */
export function isMixedContentBlocked(pageUrl: string, targetUrl: string): boolean {
  const page = parse(pageUrl)
  const target = parse(targetUrl)
  if (page === undefined || target === undefined) return false
  return page.protocol === 'https:' && target.protocol === 'http:' && !LOOPBACK_HOSTS.has(target.hostname)
}
