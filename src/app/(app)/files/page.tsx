'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, RotateCcw, Search, Star, Trash2 } from 'lucide-react'
import { api, type FileRow } from '@/lib/client/api'
import { invalidate, useCachedResource } from '@/lib/client/cache'
import { formatBytes, formatRelative } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import { FileIcon } from '@/components/FileIcon'
import { DriveInfo } from '@/components/DriveInfo'
import { UploadButton } from '@/components/UploadButton'

const TITLES: Record<string, { title: string; empty: string }> = {
  all: { title: 'Files', empty: 'Nothing stored yet. Upload something and it will route to the account with the most room.' },
  recent: { title: 'Recent', empty: 'Nothing touched recently.' },
  starred: { title: 'Starred', empty: 'Star a file to keep it here.' },
  trash: { title: 'Trash', empty: 'Trash is empty.' },
}

function FilesView() {
  const params = useSearchParams()
  const view = (params.get('view') ?? 'all') as keyof typeof TITLES
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    // Debounced so typing does not fire a request — or a cache key — per keystroke.
    const timer = setTimeout(() => setQuery(search), search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [search])

  // One cache entry per view-and-search, so flipping between Files, Starred
  // and Trash is instant after the first visit to each.
  const { data, loading, refresh } = useCachedResource(`files:${view}:${query}`, () => {
    const params = new URLSearchParams({ view, ...(query ? { search: query } : {}) })
    return api<{ files: FileRow[] }>(`/api/files?${params}`)
  })
  const files = data?.files ?? []

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
    // Starring or trashing moves a file between views, and shifts the array's
    // totals — every cached reading is suspect, not just this list.
    invalidate()
    await refresh()
  }

  async function remove(id: string, permanent: boolean) {
    await api(`/api/files/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' })
    invalidate()
    await refresh()
  }

  const meta = TITLES[view] ?? TITLES.all

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{meta.title}</h1>
          <p className="mt-1 text-sm text-dim">
            {files.length}
            {files.length === 100 ? '+' : ''} {files.length === 1 ? 'file' : 'files'}
          </p>
        </div>
        {view !== 'trash' && <UploadButton />}
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          className="w-full rounded-sm border border-line bg-panel py-2.5 pl-9 pr-3 text-sm placeholder:text-faint focus:border-line-bright"
        />
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-sm bg-panel" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <p className="mx-auto max-w-sm text-sm text-dim">{search ? `Nothing matches “${search}”.` : meta.empty}</p>
        </div>
      ) : (
        <ul className="panel divide-y divide-line">
          {files.map((file) => (
            <li key={file.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-lift/50">
              <FileIcon mimeType={file.mimeType} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{file.name}</p>
                {/* The owning drive is deliberately absent here. The volume is
                    meant to read as one disk; the info dot is how you look
                    underneath when you actually need to. */}
                <p className="truncate text-xs text-faint">
                  <span className="readout">{formatBytes(file.sizeBytes)}</span> · {formatRelative(file.updatedAt)}
                </p>
              </div>

              <DriveInfo
                bayIndex={file.account.bayIndex}
                driveEmail={file.account.email}
                sizeBytes={file.sizeBytes}
                mimeType={file.mimeType}
                createdAt={file.createdAt}
              />

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {view === 'trash' ? (
                  <>
                    <IconButton label="Restore" onClick={() => patch(file.id, { restore: true })}>
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                    <IconButton label="Delete forever" danger onClick={() => remove(file.id, true)}>
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      label={file.starred ? 'Unstar' : 'Star'}
                      onClick={() => patch(file.id, { starred: !file.starred })}
                    >
                      <Star
                        className={cn('h-3.5 w-3.5', file.starred && 'fill-signal text-signal')}
                        strokeWidth={1.75}
                      />
                    </IconButton>
                    <a
                      href={`/api/files/${file.id}/content?download=1`}
                      className="rounded-sm p-1.5 text-dim transition-colors hover:bg-lift hover:text-ink"
                      aria-label={`Download ${file.name}`}
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </a>
                    <IconButton label="Move to trash" onClick={() => remove(file.id, false)}>
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-sm p-1.5 text-dim transition-colors hover:bg-lift',
        danger ? 'hover:text-alarm' : 'hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export default function FilesPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-sm bg-panel" />}>
      <FilesView />
    </Suspense>
  )
}
