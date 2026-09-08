'use client'

import { useState } from 'react'
import { formatBytes, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import type { Bay } from '@/lib/client/api'

/**
 * The array presented as a single disk.
 *
 * The bar is one continuous volume — that is the product's whole promise — but
 * each contributing drive is a segment within it, separated by a hairline. So
 * it reads as one disk at a glance, and hovering shows you the physical truth
 * underneath. Nine separate bars would undo the illusion the product exists to
 * create; hiding the seams entirely would make it impossible to reason about.
 */
export function VolumeMeter({
  totalBytes,
  usedBytes,
  availableBytes,
  bays,
  nextBayIndex,
}: {
  totalBytes: string
  usedBytes: string
  availableBytes: string
  bays: Bay[]
  nextBayIndex?: number | null
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const online = bays.filter((b) => b.state === 'online' || b.state === 'degraded')
  const total = Number(totalBytes) || 0
  const usedPct = percent(usedBytes, totalBytes)

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="eyebrow">Volume</span>
        <span className="readout text-[10px] text-faint">
          {online.length} {online.length === 1 ? 'DRIVE' : 'DRIVES'} POOLED
        </span>
      </div>

      <div className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="readout flex items-baseline gap-2">
              <span className="text-5xl font-medium tracking-tighter">{formatBytes(totalBytes).split(' ')[0]}</span>
              <span className="text-lg text-dim">{formatBytes(totalBytes).split(' ')[1]}</span>
            </div>
            <p className="mt-1 text-xs text-faint">total capacity</p>
          </div>

          <div className="flex gap-8">
            <div className="text-right">
              <div className="readout text-xl text-flow">{formatBytes(usedBytes)}</div>
              <p className="mt-0.5 text-xs text-faint">used</p>
            </div>
            <div className="text-right">
              <div className="readout text-xl">{formatBytes(availableBytes)}</div>
              <p className="mt-0.5 text-xs text-faint">free</p>
            </div>
          </div>
        </div>

        {/* One bar. Segments are the physical drives underneath it. */}
        <div
          className="mt-7 flex h-8 w-full overflow-hidden rounded-sm border border-line bg-void"
          onMouseLeave={() => setHovered(null)}
        >
          {total === 0 ? (
            <div className="flex w-full items-center justify-center text-[10px] text-faint">NO CAPACITY</div>
          ) : (
            online.map((bay) => {
              const share = (Number(bay.totalBytes ?? 0) / total) * 100
              const fill = percent(bay.usedBytes, bay.totalBytes)
              const isNext = bay.index === nextBayIndex
              const dim = hovered !== null && hovered !== bay.index

              return (
                <div
                  key={bay.index}
                  onMouseEnter={() => setHovered(bay.index)}
                  title={`Bay ${String(bay.index).padStart(2, '0')} · ${bay.email} · ${formatBytes(bay.usedBytes)} of ${formatBytes(bay.totalBytes)}`}
                  className={cn(
                    'relative h-full border-r border-line/80 transition-opacity last:border-r-0',
                    dim && 'opacity-30',
                  )}
                  style={{ width: `${share}%` }}
                >
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 transition-[width] duration-500',
                      bay.state === 'degraded' ? 'bg-alarm/70' : isNext ? 'bg-signal' : 'bg-flow',
                    )}
                    style={{ width: `${fill}%` }}
                  />
                  {/* Below ~4% the segment is narrower than the label; drop it
                      rather than let two digits overflow into the neighbour. */}
                  <span className="readout absolute inset-0 flex items-center justify-center text-[9px] text-ink/70">
                    {share >= 4 ? String(bay.index).padStart(2, '0') : ''}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-2 flex justify-between">
          <span className="readout text-[10px] text-faint">{usedPct.toFixed(1)}% FULL</span>
          <span className="readout text-[10px] text-faint">
            {hovered !== null
              ? `BAY ${String(hovered).padStart(2, '0')} — ${online.find((b) => b.index === hovered)?.email ?? ''}`
              : 'HOVER A SEGMENT TO IDENTIFY THE DRIVE'}
          </span>
        </div>
      </div>
    </section>
  )
}
