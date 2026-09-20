import { cn } from '@/lib/cn'

/** The bar-graph mark. Shared so the rail and the phone bar cannot drift. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex items-end gap-[3px]" aria-hidden>
        {[10, 16, 7, 20].map((h, i) => (
          <span
            key={i}
            className={cn('w-[3px] rounded-[1px]', i === 3 ? 'bg-signal' : 'bg-line-bright')}
            style={{ height: h }}
          />
        ))}
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">9Drive</span>
    </span>
  )
}
