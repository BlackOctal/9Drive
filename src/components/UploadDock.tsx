'use client'

import { ChevronDown, X } from 'lucide-react'
import { useUploads, type UploadItem } from '@/lib/client/uploader'
import { formatBytes } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import { CapacityBar } from './CapacityBar'

/**
 * A live view of where each file is going, not just how far along it is.
 * The routed account is the interesting part — it makes the routing policy
 * something you can watch happen rather than something you have to trust.
 */
export function UploadDock() {
  const { items, open, setOpen, cancel, dismiss, clearFinished } = useUploads()
  if (items.length === 0) return null

  const active = items.filter((i) => i.status === 'uploading' || i.status === 'preparing')
  const finished = items.length - active.length

  return (
    <div className="fixed bottom-0 right-0 z-50 w-full max-w-sm p-4 sm:p-5">
      <div className="panel overflow-hidden shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="eyebrow">
            {active.length > 0 ? `Uploading ${active.length}` : `${finished} finished`}
          </span>
          {finished > 0 && active.length === 0 && (
            <button onClick={clearFinished} className="text-xs text-dim transition-colors hover:text-ink">
              Clear
            </button>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="ml-auto text-dim transition-colors hover:text-ink"
            aria-label={open ? 'Collapse uploads' : 'Expand uploads'}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} strokeWidth={1.75} />
          </button>
        </div>

        {open && (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {items.map((item) => (
              <Row key={item.id} item={item} onCancel={cancel} onDismiss={dismiss} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({
  item,
  onCancel,
  onDismiss,
}: {
  item: UploadItem
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const pct = item.sizeBytes > 0 ? (item.uploadedBytes / item.sizeBytes) * 100 : 0
  const running = item.status === 'uploading' || item.status === 'preparing'

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm">{item.name}</p>
        <button
          onClick={() => (running ? onCancel(item.id) : onDismiss(item.id))}
          className="shrink-0 text-faint transition-colors hover:text-ink"
          aria-label={running ? `Cancel ${item.name}` : `Dismiss ${item.name}`}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {running && <CapacityBar percent={pct} tone="signal" className="mt-2" />}

      <p className="mt-1.5 text-xs text-faint">
        {item.status === 'preparing' && 'Choosing an account…'}
        {item.status === 'uploading' && (
          <>
            <span className="readout">{formatBytes(item.uploadedBytes)}</span> of{' '}
            <span className="readout">{formatBytes(item.sizeBytes)}</span>
            {item.accountEmail && <> → <span className="text-signal">{item.accountEmail}</span></>}
            {item.bytesPerSecond > 0 && <> · {formatBytes(item.bytesPerSecond)}/s</>}
          </>
        )}
        {item.status === 'done' && (
          <span className="text-flow">Stored on {item.accountEmail}</span>
        )}
        {item.status === 'cancelled' && 'Cancelled'}
        {item.status === 'error' && <span className="text-alarm">{item.error}</span>}
      </p>
    </li>
  )
}
