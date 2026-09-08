'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronRight, Plus, RefreshCw, Unplug } from 'lucide-react'
import { api, type AccountSummary } from '@/lib/client/api'
import { invalidate, useCachedResource } from '@/lib/client/cache'
import { formatBytes, formatRelative, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import { CapacityBar } from '@/components/CapacityBar'

export default function AccountsPage() {
  const router = useRouter()
  const { data, loading, refresh } = useCachedResource('accounts', () =>
    api<{ accounts: AccountSummary[] }>('/api/accounts'),
  )
  const accounts = data?.accounts ?? []
  const [syncing, setSyncing] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function resync() {
    setSyncing(true)
    await api('/api/accounts/sync', { method: 'POST' }).catch(() => undefined)
    invalidate()
    await refresh()
    setSyncing(false)
  }

  async function disconnect(id: string) {
    await api(`/api/accounts/${id}`, { method: 'DELETE' })
    setConfirming(null)
    // A removed drive changes the array, the routing preview and the vault
    // too, so nothing cached survives it.
    invalidate()
    await refresh()
  }

  const pooled = accounts.reduce((sum, a) => sum + Number(a.quota.totalBytes ?? 0), 0)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Drives</h1>
          <p className="mt-1 text-sm text-dim">
            {accounts.length === 0
              ? 'Nothing connected yet.'
              : `${accounts.length} connected, ${formatBytes(pooled)} pooled.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resync}
            disabled={syncing || accounts.length === 0}
            className="flex items-center gap-2 rounded-sm border border-line px-3 py-2 text-xs text-dim transition-colors hover:border-line-bright hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} strokeWidth={1.75} />
            Re-read quota
          </button>
          <a
            href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/accounts"
            className="flex items-center gap-2 rounded-sm bg-signal px-3 py-2 text-xs font-semibold text-void transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Connect account
          </a>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-sm bg-panel" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <p className="text-sm text-dim">
            Connect your first Google account to give 9Drive somewhere to put things.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => {
            const filled = percent(account.quota.usedBytes, account.quota.totalBytes)
            const broken = account.status !== 'connected'
            return (
              <li
                key={account.id}
                onClick={() => router.push(`/drives/${account.id}`)}
                className={cn(
                  'panel cursor-pointer p-5 transition-colors hover:border-line-bright',
                  broken && 'border-alarm/40',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="readout mt-0.5 shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-faint">
                      BAY {String(account.bayIndex).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      {/* A real anchor, so the row is reachable by keyboard and
                          not just by the click handler on the card. */}
                      <Link
                        href={`/drives/${account.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 truncate text-sm font-medium hover:underline"
                      >
                        {account.email}
                        <ChevronRight className="h-3 w-3 shrink-0 text-faint" strokeWidth={2} />
                      </Link>
                      <p className="mt-0.5 text-xs text-faint">
                        {account.fileCount.toLocaleString()} files · checked{' '}
                        {formatRelative(account.quota.lastSyncedAt)}
                      </p>
                    </div>
                  </div>

                  {confirming === account.id ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="max-w-xs text-right text-xs text-dim">
                        {account.secretFileCount > 0 ? (
                          <span className="text-warn">
                            {account.secretFileCount} vault{' '}
                            {account.secretFileCount === 1 ? 'file lives' : 'files live'} here. Disconnecting
                            discards the keys that decrypt {account.secretFileCount === 1 ? 'it' : 'them'} —
                            permanently. Ordinary files stay on Drive.
                          </span>
                        ) : (
                          'Remove pointers? Drive files stay.'
                        )}
                      </span>
                      <button
                        onClick={() => disconnect(account.id)}
                        className="rounded-sm bg-alarm px-2.5 py-1.5 text-xs font-semibold text-void"
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="rounded-sm border border-line px-2.5 py-1.5 text-xs text-dim hover:text-ink"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {broken && (
                        <a
                          href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/accounts"
                          className="rounded-sm border border-warn/40 px-2.5 py-1.5 text-xs text-warn transition-colors hover:bg-warn/10"
                        >
                          Reconnect
                        </a>
                      )}
                      <button
                        onClick={() => setConfirming(account.id)}
                        className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-xs text-dim transition-colors hover:border-line-bright hover:text-ink"
                      >
                        <Unplug className="h-3 w-3" strokeWidth={1.75} />
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <CapacityBar percent={filled} tone={filled > 90 ? 'alarm' : filled > 75 ? 'warn' : 'flow'} />
                  <div className="mt-2 flex justify-between">
                    <span className="readout text-[10px] text-faint">
                      {formatBytes(account.quota.usedBytes)} / {formatBytes(account.quota.totalBytes)}
                    </span>
                    <span className="readout text-[10px] text-faint">
                      {formatBytes(account.quota.availableBytes)} FREE
                    </span>
                  </div>
                </div>

                {account.lastError && (
                  <p className="mt-3 flex items-start gap-2 rounded-sm bg-alarm/5 px-3 py-2 text-xs text-alarm">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    {account.lastError}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
