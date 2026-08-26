export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
