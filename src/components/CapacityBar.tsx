import { cn } from '@/lib/cn'

/** A horizontal fill bar with a hairline cap, matching the tank gauges. */
export function CapacityBar({ percent, tone = 'flow', className }: { percent: number; tone?: 'flow' | 'signal' | 'warn' | 'alarm'; className?: string }) {
  const width = Math.min(100, Math.max(percent > 0 ? 0.8 : 0, percent))
  const fill = { flow: 'bg-flow', signal: 'bg-signal', warn: 'bg-warn', alarm: 'bg-alarm' }[tone]

  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-void', className)}>
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', fill)}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
