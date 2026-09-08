'use client'

import { Download, FileQuestion, X } from 'lucide-react'
import { formatBytes, formatDate } from '@/lib/bytes'
import type { DriveEntry } from '@/lib/client/api'

/**
 * Containers a browser will actually decode.
 *
 * Extension is checked before mimeType on purpose: Drive frequently labels an
 * MKV as video/mp4 or application/octet-stream, and trusting that label is how
 * you end up rendering a player that shows a black rectangle forever.
 */
const PLAYABLE_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv'])
const UNPLAYABLE_EXT = new Set([
  'mkv', 'avi', 'mov', 'wmv', 'flv', 'f4v', 'mpg', 'mpeg', 'mpe',
  '3gp', '3g2', 'ts', 'm2ts', 'mts', 'vob', 'rm', 'rmvb', 'divx', 'asf', 'ogm',
])
const PLAYABLE_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/x-m4v'])

function canPlayVideo(name: string, mimeType: string): boolean {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (UNPLAYABLE_EXT.has(ext)) return false
  if (PLAYABLE_EXT.has(ext)) return true
  return PLAYABLE_MIME.has(mimeType.toLowerCase())
}

/**
 * What the content route hands back for a Google-native type, and therefore
 * what can be rendered. Sheets export to XLSX, which is a download and not a
 * preview.
 */
const NATIVE_EXPORT: Record<string, 'pdf' | 'image' | null> = {
  'application/vnd.google-apps.document': 'pdf',
  'application/vnd.google-apps.presentation': 'pdf',
  'application/vnd.google-apps.drawing': 'image',
  'application/vnd.google-apps.spreadsheet': null,
}

type Mode =
  | { kind: 'video' }
  | { kind: 'image' }
  | { kind: 'pdf' }
  | { kind: 'none'; reason: string }

function resolveMode(entry: DriveEntry): Mode {
  if (entry.mimeType in NATIVE_EXPORT) {
    const exported = NATIVE_EXPORT[entry.mimeType]
    if (exported === 'pdf') return { kind: 'pdf' }
    if (exported === 'image') return { kind: 'image' }
    return { kind: 'none', reason: 'Sheets export to XLSX, which has nothing to render in a browser.' }
  }
  if (entry.mimeType.startsWith('image/')) return { kind: 'image' }
  if (entry.mimeType === 'application/pdf') return { kind: 'pdf' }
  if (entry.mimeType.startsWith('video/') || UNPLAYABLE_EXT.has(entry.name.toLowerCase().split('.').pop() ?? '')) {
    return canPlayVideo(entry.name, entry.mimeType)
      ? { kind: 'video' }
      : { kind: 'none', reason: "This format can't be played in the browser — download to watch." }
  }
  return { kind: 'none', reason: 'No preview for this format.' }
}

/**
 * A right-hand drawer over the listing.
 *
 * Video points straight at the content route, which forwards Range and returns
 * a real 206 — so seeking works without pulling the file down first.
 * `preload="metadata"` keeps opening the drawer from starting that download.
 */
export function DrivePreview({
  entry,
  accountId,
  onClose,
}: {
  entry: DriveEntry
  accountId: string
  onClose: () => void
}) {
  const src = `/api/drives/${accountId}/content/${encodeURIComponent(entry.id)}`
  const mode = resolveMode(entry)

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-line bg-panel shadow-2xl"
      role="dialog"
      aria-label={`Preview of ${entry.name}`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <span className="eyebrow">Preview</span>
          <p className="mt-0.5 truncate text-sm">{entry.name}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close preview"
          className="shrink-0 rounded-sm border border-line p-1.5 text-dim transition-colors hover:border-line-bright hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-auto bg-void p-4">
        {mode.kind === 'video' ? (
          <video src={src} controls preload="metadata" className="max-h-full w-full" />
        ) : mode.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={entry.name} className="max-h-full max-w-full object-contain" />
        ) : mode.kind === 'pdf' ? (
          <iframe src={src} title={entry.name} className="h-full w-full border-0 bg-white" />
        ) : (
          <div className="max-w-xs text-center">
            <FileQuestion className="mx-auto h-8 w-8 text-faint" strokeWidth={1.25} />
            <p className="mt-3 text-sm text-dim">{mode.reason}</p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <p className="readout truncate text-[10px] text-faint">
          {entry.size ? formatBytes(entry.size) : '—'}
          {entry.modifiedTime && ` · ${formatDate(entry.modifiedTime)}`}
        </p>
        <a
          href={`${src}?download=1`}
          className="flex shrink-0 items-center gap-2 rounded-sm border border-line px-3 py-2 text-xs text-dim transition-colors hover:border-line-bright hover:text-ink"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
          Download
        </a>
      </footer>
    </aside>
  )
}
