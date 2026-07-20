import { isTauri } from '../api/transport'

export type Environment = 'browser' | 'desktop'

/** Laufzeitumgebung der App, abgeleitet von der einzigen Umgebungs-Erkennung in `api/transport.ts`. */
export function getEnvironment(): Environment {
  return isTauri() ? 'desktop' : 'browser'
}
