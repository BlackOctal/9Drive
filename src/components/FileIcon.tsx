import { Archive, FileText, Film, Image as ImageIcon, Music, Table2, type LucideIcon } from 'lucide-react'

const RULES: Array<[RegExp, LucideIcon, string]> = [
  [/^image\//, ImageIcon, 'text-flow'],
  [/^video\//, Film, 'text-signal'],
  [/^audio\//, Music, 'text-warn'],
  [/(zip|tar|gzip|compressed|7z|rar)/, Archive, 'text-dim'],
  [/(spreadsheet|csv|excel)/, Table2, 'text-flow'],
]

export function FileIcon({ mimeType, className = 'h-4 w-4' }: { mimeType: string; className?: string }) {
  const match = RULES.find(([pattern]) => pattern.test(mimeType))
  const Icon = match?.[1] ?? FileText
  return <Icon className={`${className} ${match?.[2] ?? 'text-faint'} shrink-0`} strokeWidth={1.75} />
}
