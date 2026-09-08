'use client'

import { useState } from 'react'
import { AlertTriangle, HardDrive, Plus, RefreshCw } from 'lucide-react'
import { api, type ArrayStatus } from '@/lib/client/api'
import { invalidate, useCachedResource } from '@/lib/client/cache'
import { formatBytes, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import { VolumeMeter } from '@/components/VolumeMeter'
import { BayRack } from '@/components/BayRack'
import { UploadButton } from '@/components/UploadButton'

const KIND_LABELS: Record<string, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archives',
  document: 'Documents',
}

export default function ArrayPage() {
  // Cached across navigation: this reading can cost seconds when the server
  // has to re-read quota from Google, and none of it goes stale in the time it
  // takes to look at another tab.
  const { data: status, loading, refresh } = useCachedResource(
    'array',
    () => api<ArrayStatus>('/api/array'),
    // Keep the panel live without hammering Google: the server only re-reads
    // quota when its own cached reading is stale.
    { refreshInterval: 30_000 },
  )
  const [syncing, setSyncing] = useState(false)

  async function resync() {
    setSyncing(true)
    await api('/api/accounts/sync', { method: 'POST' }).catch(() => undefined)
    // Every page's numbers move when quota is re-read, not just this one.
    invalidate()
    await refresh()
    setSyncing(false)
  }

  if (loading || !status) return <Skeleton />
  if (status.onlineCount === 0 && status.degradedCount === 0) return <FirstDrive />

  const nextBay = status.bays.find((b) => b.accountId === status.nextTarget?.accountId)?.index ?? null
  const faults = status.bays.filter((b) => b.state === 'degraded')

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Array</h1>
            <span
              className={cn(
                'readout rounded-sm border px-1.5 py-0.5 text-[10px]',
                faults.length > 0 ? 'border-alarm/40 text-alarm' : 'border-flow/30 text-flow',
              )}
            >
              {faults.length > 0 ? 'DEGRADED' : 'HEALTHY'}
            </span>
          </div>
          <p className="mt-1 text-sm text-dim">
            {status.onlineCount} of {status.chassisSize} bays populated ·{' '}
            {status.volume.fileCount.toLocaleString()} files
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={resync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-sm border border-line px-3 py-2 text-xs text-dim transition-colors hover:border-line-bright hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} strokeWidth={1.75} />
            {syncing ? 'Polling' : 'Poll drives'}
          </button>
          <UploadButton />
        </div>
      </header>

      {faults.length > 0 && (
        <div className="flex items-start gap-3 rounded-sm border border-alarm/30 bg-alarm/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alarm" strokeWidth={1.75} />
          <p className="text-sm">
            <span className="text-ink">
              {faults.length === 1 ? 'Bay' : 'Bays'}{' '}
              {faults.map((b) => String(b.index).padStart(2, '0')).join(', ')} reporting a fault.
            </span>{' '}
            <span className="text-dim">
              Their capacity is excluded from the volume and writes route around them.
            </span>
          </p>
        </div>
      )}

      <VolumeMeter
        totalBytes={status.volume.totalBytes}
        usedBytes={status.volume.usedBytes}
        availableBytes={status.volume.availableBytes}
        bays={status.bays}
        nextBayIndex={nextBay}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <BayRack bays={status.bays} nextBayIndex={nextBay} />

        <div className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <span className="eyebrow">Write target</span>
            </div>
            <div className="p-5">
              {status.nextTarget && nextBay ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal animate-signal" aria-hidden />
                    <span className="readout text-sm text-signal">
                      BAY {String(nextBay).padStart(2, '0')}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-xs text-dim">{status.nextTarget.email}</p>
                  <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-faint">
                    {status.nextTarget.reason}
                  </p>
                </>
              ) : (
                <p className="text-xs text-warn">No bay has room for a new write.</p>
              )}
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <span className="eyebrow">Telemetry</span>
            </div>
            <dl className="divide-y divide-line">
              <Stat label="Files stored" value={status.volume.fileCount.toLocaleString()} />
              <Stat label="Written today" value={status.volume.uploadsToday.toLocaleString()} />
              <Stat
                label="Bays free"
                value={String(status.chassisSize - status.onlineCount - status.degradedCount)}
              />
            </dl>
          </section>
        </div>
      </div>

      {status.breakdown.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <span className="eyebrow">Contents</span>
          </div>
          <div className="space-y-3 p-5">
            {[...status.breakdown]
              .sort((a, b) => Number(b.bytes) - Number(a.bytes))
              .map((row) => (
                <div key={row.kind} className="flex items-center gap-4">
                  <span className="w-24 shrink-0 text-sm text-dim">{KIND_LABELS[row.kind] ?? row.kind}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-void">
                    <span
                      className="block h-full rounded-full bg-flow"
                      style={{ width: `${percent(row.bytes, status.volume.usedBytes)}%` }}
                    />
                  </div>
                  <span className="readout w-20 shrink-0 text-right text-xs">{formatBytes(row.bytes)}</span>
                  <span className="readout w-12 shrink-0 text-right text-[10px] text-faint">
                    {row.count.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between px-5 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="readout text-sm">{value}</dd>
    </div>
  )
}

function FirstDrive() {
  return (
    <div className="flex min-h-[65vh] flex-col items-center justify-center text-center">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'flex h-16 w-8 items-center justify-center rounded-[2px] border',
              i === 0 ? 'border-signal/50 bg-signal/5 lit' : 'border-line bg-void/60',
            )}
          >
            <span className={cn('h-1 w-1 rounded-full', i === 0 ? 'bg-signal animate-signal' : 'bg-line')} />
          </span>
        ))}
      </div>

      <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight">Chassis is empty</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-dim">
        Install a Google account into bay 01 to bring the volume online. Each drive you add after that extends the
        same volume — the capacity above grows, and nothing else about how you use it changes.
      </p>

      <a
        href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/"
        className="mt-7 flex items-center gap-2 rounded-sm bg-signal px-4 py-2.5 text-sm font-semibold text-void transition-opacity hover:opacity-90"
      >
        <HardDrive className="h-4 w-4" strokeWidth={2} />
        Install drive in bay 01
      </a>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-40 animate-pulse rounded-sm bg-panel" />
      <div className="h-56 animate-pulse rounded-sm bg-panel" />
      <div className="h-72 animate-pulse rounded-sm bg-panel" />
    </div>
  )
}
