'use client'

import { formatBytes, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import type { AccountSummary } from '@/lib/client/api'

/**
 * The signature element: one vertical gauge per connected account, read as a
 * bank of fuel tanks. Amber marks the tank the next upload will feed.
 *
 * A ring chart would show the same numbers, but it would show them as one
 * blended total — and the whole point of this product is that the storage is
 * *not* one pool. Nine separate columns of different fill levels is the honest
 * picture, and it makes an imbalance visible at a glance.
 */
export function TankGauges({
  accounts,
  nextAccountId,
  onSelect,
  selectedId,
}: {
  accounts: AccountSummary[]
  nextAccountId?: string | null
  onSelect?: (id: string | null) => void
  selectedId?: string | null
}) {
  if (accounts.length === 0) return null

  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="list">
      {accounts.map((account) => {
        const { totalBytes, usedBytes } = account.quota
        const filled = percent(usedBytes, totalBytes)
        const isNext = account.id === nextAccountId
        const isSelected = account.id === selectedId
        const unhealthy = account.status !== 'connected' || Boolean(account.lastError)
        const nearFull = filled >= 90

        const tone = unhealthy
          ? 'bg-alarm'
          : nearFull
            ? 'bg-warn'
            : isNext
              ? 'bg-signal'
              : 'bg-flow'

        return (
          <button
            key={account.id}
            type="button"
            role="listitem"
            onClick={() => onSelect?.(isSelected ? null : account.id)}
            title={`${account.email} — ${formatBytes(usedBytes)} of ${formatBytes(totalBytes)} used`}
            className={cn(
              'group relative flex min-w-14 flex-1 flex-col items-center gap-2 rounded-sm px-1 pt-2 pb-1.5 transition-colors',
              isSelected ? 'bg-lift' : 'hover:bg-lift/60',
            )}
          >
            {/* The tank body */}
            <div
              className={cn(
                'relative h-28 w-full overflow-hidden rounded-[2px] border bg-void/70',
                isNext ? 'border-signal/60 lit' : 'border-line',
              )}
            >
              {/* Quarter marks, unlit, etched into the tank face */}
              {[25, 50, 75].map((mark) => (
                <span
                  key={mark}
                  aria-hidden
                  className="absolute left-0 h-px w-full bg-line-bright/40"
                  style={{ bottom: `${mark}%` }}
                />
              ))}

              <span
                className={cn('absolute inset-x-0 bottom-0 animate-settle transition-[height] duration-500', tone)}
                style={{ height: `${Math.max(filled, filled > 0 ? 1.5 : 0)}%` }}
              />

              {/* Fill level line, brighter than the fill itself */}
              {filled > 0 && (
                <span
                  aria-hidden
                  className={cn('absolute inset-x-0 h-px', unhealthy ? 'bg-alarm' : nearFull ? 'bg-warn' : isNext ? 'bg-signal' : 'bg-flow')}
                  style={{ bottom: `${Math.max(filled, 1.5)}%`, filter: 'brightness(1.6)' }}
                />
              )}
            </div>

            <span className={cn('readout text-[10px] leading-none', isNext ? 'text-signal' : 'text-dim')}>
              {Math.round(filled)}
            </span>

            {/* The feed indicator. Only one of these is ever lit. */}
            <span
              aria-hidden
              className={cn(
                'h-1 w-4 rounded-full transition-colors',
                isNext ? 'bg-signal animate-signal' : 'bg-line',
              )}
            />

            <span className="sr-only">
              {account.email}, {Math.round(filled)} percent full{isNext ? ', receiving the next upload' : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}
