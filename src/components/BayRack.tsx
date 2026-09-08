'use client'

import { Lock, Plus, RotateCw } from 'lucide-react'
import { formatBytes, formatRelative, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import type { Bay } from '@/lib/client/api'

const STATE_LABEL: Record<Bay['state'], string> = {
  online: 'ONLINE',
  degraded: 'FAULT',
  empty: 'EMPTY',
  locked: 'LOCKED',
}

/** A status LED, the way a real chassis reports a slot. */
function Led({ state, feeding }: { state: Bay['state']; feeding: boolean }) {
  const tone = {
    online: feeding ? 'bg-signal' : 'bg-flow',
    degraded: 'bg-alarm',
    empty: 'bg-line-bright',
    locked: 'bg-line',
  }[state]

  return (
    <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
      <span className={cn('h-2 w-2 rounded-full', tone, feeding && 'animate-signal')} />
      {state === 'online' && (
        <span className={cn('absolute h-2 w-2 rounded-full blur-[3px]', tone, 'opacity-60')} />
      )}
    </span>
  )
}

export function BayRack({ bays, nextBayIndex }: { bays: Bay[]; nextBayIndex?: number | null }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="eyebrow">Drive bays</span>
        <span className="readout text-[10px] text-faint">
          {bays.filter((b) => b.state === 'online').length} / {bays.length} POPULATED
        </span>
      </div>

      <ul className="divide-y divide-line">
        {bays.map((bay) => {
          const feeding = bay.index === nextBayIndex && bay.state === 'online'
          const fill = percent(bay.usedBytes, bay.totalBytes)

          return (
            <li
              key={bay.index}
              className={cn(
                'flex items-center gap-4 px-5 py-3.5 transition-colors',
                bay.state === 'locked' && 'opacity-40',
                feeding && 'bg-signal/[0.04]',
              )}
            >
              <Led state={bay.state} feeding={feeding} />

              <span className="readout w-6 shrink-0 text-xs text-faint">
                {String(bay.index).padStart(2, '0')}
              </span>

              <div className="min-w-0 flex-1">
                {bay.email ? (
                  <>
                    <p className="truncate text-sm">{bay.email}</p>
                    <p className="readout mt-0.5 text-[10px] text-faint">
                      {formatBytes(bay.usedBytes)} / {formatBytes(bay.totalBytes)} · checked{' '}
                      {formatRelative(bay.lastSyncedAt)}
                      {!bay.dedicatedCredentials && ' · shared client'}
                    </p>
                  </>
                ) : bay.state === 'empty' ? (
                  <p className="text-sm text-dim">Ready for a drive</p>
                ) : (
                  <p className="text-sm text-faint">{bay.lockedReason}</p>
                )}
              </div>

              {/* Per-bay fill, kept small: the volume meter above is the headline. */}
              {bay.totalBytes && (
                <div className="hidden w-28 shrink-0 sm:block">
                  <div className="h-1 overflow-hidden rounded-full bg-void">
                    <span
                      className={cn(
                        'block h-full rounded-full transition-[width] duration-500',
                        bay.state === 'degraded' ? 'bg-alarm' : fill > 90 ? 'bg-warn' : feeding ? 'bg-signal' : 'bg-flow',
                      )}
                      style={{ width: `${Math.max(fill, 1)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex w-24 shrink-0 justify-end">
                {bay.state === 'empty' ? (
                  <a
                    href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/"
                    className="flex items-center gap-1.5 rounded-sm bg-signal px-2.5 py-1.5 text-[11px] font-semibold text-void transition-opacity hover:opacity-90"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2.5} />
                    Install
                  </a>
                ) : bay.state === 'degraded' ? (
                  <a
                    href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/"
                    className="flex items-center gap-1.5 rounded-sm border border-alarm/40 px-2.5 py-1.5 text-[11px] text-alarm transition-colors hover:bg-alarm/10"
                  >
                    <RotateCw className="h-3 w-3" strokeWidth={2} />
                    Repair
                  </a>
                ) : bay.state === 'locked' ? (
                  <Lock className="h-3 w-3 text-faint" strokeWidth={2} />
                ) : (
                  <span
                    className={cn('readout text-[10px]', feeding ? 'text-signal' : 'text-faint')}
                    title={feeding ? 'Receiving the next write' : undefined}
                  >
                    {feeding ? 'WRITING' : STATE_LABEL[bay.state]}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
