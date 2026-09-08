import { splitBytes } from '@/lib/bytes'
import { cn } from '@/lib/cn'

/** A big instrument figure: value large, unit small, label above. */
export function Readout({
  label,
  bytes,
  value,
  tone = 'ink',
  size = 'md',
}: {
  label: string
  bytes?: string | number | bigint | null
  value?: string
  tone?: 'ink' | 'signal' | 'flow' | 'dim'
  size?: 'md' | 'lg'
}) {
  const [num, unit] = bytes !== undefined ? splitBytes(bytes) : [value ?? '—', '']
  const toneClass = { ink: 'text-ink', signal: 'text-signal', flow: 'text-flow', dim: 'text-dim' }[tone]

  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={cn('readout mt-1 flex items-baseline gap-1', toneClass)}>
        <span className={cn('font-medium tracking-tight', size === 'lg' ? 'text-4xl' : 'text-2xl')}>{num}</span>
        {unit && <span className="text-xs text-dim">{unit}</span>}
      </div>
    </div>
  )
}
