/** BigInt byte counts cross the JSON boundary as strings, always. */
export function serializeBytes(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString()
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(input: string | number | bigint | null | undefined, precision?: number): string {
  if (input === null || input === undefined) return '—'
  const bytes = Number(input)
  if (!Number.isFinite(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  const digits = precision ?? (i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2)
  return `${value.toFixed(digits)} ${UNITS[i]}`
}

/** Splits the number from its unit so they can be typeset differently. */
export function splitBytes(input: string | number | bigint | null | undefined): [string, string] {
  const formatted = formatBytes(input)
  const [value, unit = ''] = formatted.split(' ')
  return [value, unit]
}

type Numeric = string | number | bigint | null | undefined

export function percent(used: Numeric, total: Numeric): number {
  if (total === null || total === undefined) return 0
  const t = Number(total)
  if (!t) return 0
  return Math.min(100, Math.max(0, (Number(used ?? 0) / t) * 100))
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never'
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
