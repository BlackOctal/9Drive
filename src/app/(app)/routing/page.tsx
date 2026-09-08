'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { api, type AccountSummary } from '@/lib/client/api'
import { invalidate, mutate, useCachedResource } from '@/lib/client/cache'
import { formatBytes, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'

type Mode = 'most_available' | 'round_robin' | 'priority' | 'fill_first'

const MODES: Array<{ id: Mode; name: string; description: string }> = [
  { id: 'most_available', name: 'Most free space', description: 'Each file goes to whichever account has the most room. Keeps accounts filling evenly.' },
  { id: 'round_robin', name: 'Round robin', description: 'Cycles through accounts one file at a time. Spreads files widely rather than evenly by size.' },
  { id: 'priority', name: 'Priority order', description: 'Uses the first account in your list that has room. Reorder them below.' },
  { id: 'fill_first', name: 'Fill one at a time', description: 'Packs each account to capacity before moving on. Keeps related files together.' },
]

type Policy = { mode: Mode; priorityOrder: string[]; headroomPercent: number }
type NextTarget = { accountId: string; email: string; reason: string } | null

export default function RoutingPage() {
  // Two entries, and the accounts one is shared with the Drives page — so
  // arriving here from there costs nothing.
  const routing = useCachedResource('routing-policy', () =>
    api<{ policy: Policy; nextTarget: NextTarget }>('/api/storage/routing-policy'),
  )
  const { data: accountData } = useCachedResource('accounts', () =>
    api<{ accounts: AccountSummary[] }>('/api/accounts'),
  )

  const accounts = accountData?.accounts ?? []
  const policy = routing.data?.policy ?? null
  const nextTarget = routing.data?.nextTarget ?? null
  const [saved, setSaved] = useState(false)

  async function save(next: Partial<Policy>) {
    if (!policy) return
    const merged = { ...policy, ...next }
    // Optimistic: the controls should answer the click, not the round trip.
    mutate('routing-policy', { policy: merged, nextTarget })
    const res = await api<{ policy: Policy; nextTarget: NextTarget }>('/api/storage/routing-policy', {
      method: 'PATCH',
      body: JSON.stringify(merged),
    })
    mutate('routing-policy', res)
    // The array panel shows where the next write goes; that has just changed.
    invalidate('array')
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  if (!policy) return <div className="h-64 animate-pulse rounded-sm bg-panel" />

  // Accounts in the order this policy would actually consider them.
  const ordered = policy.mode === 'priority' || policy.mode === 'round_robin'
    ? [...accounts].sort((a, b) => {
        const ia = policy.priorityOrder.indexOf(a.id)
        const ib = policy.priorityOrder.indexOf(b.id)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })
    : accounts

  function move(id: string, direction: -1 | 1) {
    const list = ordered.map((a) => a.id)
    const from = list.indexOf(id)
    const to = from + direction
    if (to < 0 || to >= list.length) return
    ;[list[from], list[to]] = [list[to], list[from]]
    void save({ priorityOrder: list })
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Routing</h1>
        <p className="mt-1 text-sm text-dim">How 9Drive decides which account receives the next file.</p>
      </header>

      {nextTarget && (
        <div className="panel flex flex-wrap items-center gap-3 p-5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal animate-signal" aria-hidden />
          <div>
            <span className="eyebrow">Next upload</span>
            <p className="mt-1 text-sm text-signal">{nextTarget.email}</p>
          </div>
          <p className="ml-auto text-xs text-faint">{nextTarget.reason}</p>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {MODES.map((mode) => {
          const active = policy.mode === mode.id
          return (
            <button
              key={mode.id}
              onClick={() => save({ mode: mode.id })}
              className={cn(
                'panel p-4 text-left transition-colors',
                active ? 'border-signal/50 bg-lift' : 'hover:border-line-bright',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn('font-display text-sm font-medium', active && 'text-signal')}>{mode.name}</span>
                {active && <Check className="h-3.5 w-3.5 text-signal" strokeWidth={2.5} />}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-dim">{mode.description}</p>
            </button>
          )
        })}
      </section>

      {(policy.mode === 'priority' || policy.mode === 'round_robin') && (
        <section className="panel p-5">
          <h2 className="eyebrow mb-4">Account order</h2>
          <ul className="space-y-1.5">
            {ordered.map((account, index) => (
              <li key={account.id} className="flex items-center gap-3 rounded-sm bg-void/50 px-3 py-2.5">
                <span className="readout w-5 text-xs text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{account.email}</span>
                <span className="readout text-[10px] text-faint">
                  {formatBytes(account.quota.availableBytes)} free
                </span>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => move(account.id, -1)}
                    disabled={index === 0}
                    className="rounded-sm p-1 text-dim transition-colors hover:bg-lift hover:text-ink disabled:opacity-25"
                    aria-label={`Move ${account.email} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => move(account.id, 1)}
                    disabled={index === ordered.length - 1}
                    className="rounded-sm p-1 text-dim transition-colors hover:bg-lift hover:text-ink disabled:opacity-25"
                    aria-label={`Move ${account.email} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel p-5">
        <h2 className="eyebrow">Headroom</h2>
        <p className="mt-2 max-w-lg text-xs leading-relaxed text-dim">
          Leaves a slice of each account unused. Google&apos;s reported usage lags behind actual writes, so routing to
          the very last byte tends to produce failed uploads.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={20}
            value={policy.headroomPercent}
            // Dragging updates the cache in place; the save commits on release.
            onChange={(e) =>
              mutate('routing-policy', {
                policy: { ...policy, headroomPercent: Number(e.target.value) },
                nextTarget,
              })
            }
            onPointerUp={() => save({ headroomPercent: policy.headroomPercent })}
            onKeyUp={() => save({ headroomPercent: policy.headroomPercent })}
            className="h-1 max-w-xs flex-1 accent-[var(--color-signal)]"
          />
          <span className="readout w-10 text-sm text-signal">{policy.headroomPercent}%</span>
          {saved && <span className="text-xs text-flow">Saved</span>}
        </div>
      </section>
    </div>
  )
}
