export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB']

/** Menschenlesbare Byte-Größe (1024er-Schritte), z. B. "1.9 GB" wie im Prototyp (BACKUPS-Karte). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`
}
