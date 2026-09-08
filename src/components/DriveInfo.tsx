'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { formatBytes, formatDate } from '@/lib/bytes'

/**
 * Reveals the physical drive behind a file.
 *
 * The rest of the interface deliberately hides which account holds what — the
 * point of pooling is that you shouldn't have to care. But "shouldn't have to"
 * is not "can't find out", so every item carries this. It stays out of the way
 * until asked.
 */
export function DriveInfo({
  bayIndex,
  driveEmail,
  sizeBytes,
  mimeType,
  createdAt,
}: {
  bayIndex?: number | null
  driveEmail: string
  sizeBytes: string
  mimeType: string
  createdAt: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`Storage details — held on ${driveEmail}`}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-1 text-faint transition-colors hover:text-signal"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {open && (
        <span
          role="tooltip"
          className="panel absolute bottom-full right-0 z-30 mb-1.5 w-60 space-y-2 p-3 text-left shadow-xl shadow-black/60"
        >
          <span className="block">
            <span className="eyebrow block">Stored on</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-flow" aria-hidden />
              <span className="truncate text-xs text-ink">{driveEmail}</span>
            </span>
          </span>

          <span className="block border-t border-line pt-2">
            <Row label="Bay" value={bayIndex ? String(bayIndex).padStart(2, '0') : '—'} />
            <Row label="Size" value={formatBytes(sizeBytes)} />
            <Row label="Type" value={mimeType.split('/').pop() ?? mimeType} />
            <Row label="Added" value={formatDate(createdAt)} />
          </span>
        </span>
      )}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] text-faint">{label}</span>
      <span className="readout truncate text-[11px] text-dim">{value}</span>
    </span>
  )
}
