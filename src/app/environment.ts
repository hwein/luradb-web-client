import { isTauri } from '../api/transport'

export type Environment = 'browser' | 'desktop'

/** App runtime environment, derived from the single environment detection in `api/transport.ts`. */
export function getEnvironment(): Environment {
  return isTauri() ? 'desktop' : 'browser'
}
