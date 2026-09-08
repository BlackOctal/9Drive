'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronRight, Download, Folder, HardDrive, Loader2 } from 'lucide-react'
import { api, type DriveBrowse, type DriveEntry } from '@/lib/client/api'
import { mutate, useCachedResource } from '@/lib/client/cache'
import { formatBytes, formatRelative, percent } from '@/lib/bytes'
import { cn } from '@/lib/cn'
import { CapacityBar } from '@/components/CapacityBar'
import { FileIcon } from '@/components/FileIcon'
import { DrivePreview } from '@/components/DrivePreview'

/**
 * One physical drive, browsed live.
 *
 * Everything on this page comes from Google on request — not from the File
 * table. That is the point: it shows what is genuinely in the account,
 * including files that predate 9Drive or arrived by other means. The pooled
 * subset is marked rather than filtered, so the difference stays visible.
 */
export default function DriveBrowserPage() {
  const { accountId } = useParams<{ accountId: string }>()

  const [folderId, setFolderId] = useState('root')
  const [loadingMore, setLoadingMore] = useState(false)
  const [preview, setPreview] = useState<DriveEntry | null>(null)

  // One entry per folder, so walking back up a tree is instant. Revalidation
  // is kept lazy here: a background refetch would return page one and discard
  // any extra pages already loaded below.
  const cacheKey = `drive:${accountId}:${folderId}`
  const { data, loading, error } = useCachedResource(
    cacheKey,
    () => api<DriveBrowse>(`/api/drives/${accountId}/browse?${new URLSearchParams({ folderId })}`),
    { staleTime: 60_000, revalidateOnFocus: false },
  )
  const entries = data?.entries ?? []

  async function loadMore() {
    if (!data?.nextPageToken) return
    setLoadingMore(true)
    try {
      const query = new URLSearchParams({ folderId, pageToken: data.nextPageToken })
      const next = await api<DriveBrowse>(`/api/drives/${accountId}/browse?${query}`)
      // Appended into the cache rather than into local state, so the pages you
      // pulled are still there when you come back to this folder.
      mutate(cacheKey, { ...next, entries: [...data.entries, ...next.entries] })
    } finally {
      setLoadingMore(false)
    }
  }

  function openFolder(id: string) {
    setPreview(null)
    setFolderId(id)
  }

  const quota = data?.drive.quota
  const filled = percent(quota?.usedBytes, quota?.totalBytes)

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link href="/accounts" className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-ink">
          <ChevronRight className="h-3 w-3 rotate-180" strokeWidth={2} />
          All drives
        </Link>

        <div className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="readout mt-0.5 shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-faint">
                BAY {String(data?.drive.bayIndex ?? 0).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-display text-xl font-semibold tracking-tight">
                  {data?.drive.email ?? 'Loading drive…'}
                </h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
                  <HardDrive className="h-3 w-3" strokeWidth={1.75} />
                  Live from Google — includes files 9Drive did not upload
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <CapacityBar percent={filled} tone={filled > 90 ? 'alarm' : filled > 75 ? 'warn' : 'flow'} />
            <div className="mt-2 flex justify-between">
              <span className="readout text-[10px] text-faint">
                {formatBytes(quota?.usedBytes)} / {formatBytes(quota?.totalBytes)}
              </span>
              <span className="readout text-[10px] text-faint">{formatBytes(quota?.availableBytes)} FREE</span>
            </div>
          </div>
        </div>
      </header>

      {/* Path. Every crumb is a jump; the first goes back to the drive root. */}
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-xs">
        {(data?.breadcrumbs ?? [{ id: 'root', name: 'My Drive' }]).map((crumb, i, all) => {
          const current = i === all.length - 1
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-faint" strokeWidth={2} />}
              <button
                onClick={() => openFolder(crumb.id)}
                disabled={current}
                className={cn(
                  'max-w-[16rem] truncate rounded-sm px-1 py-0.5 transition-colors',
                  current ? 'text-ink' : 'text-dim hover:text-ink',
                )}
              >
                {crumb.name}
              </button>
            </span>
          )
        })}
      </nav>

      {error && (
        <div className="panel border-alarm/40 px-5 py-4">
          <p className="text-sm text-alarm">{error.message}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-sm bg-panel" />
          ))}
        </div>
      ) : entries.length === 0 && !error ? (
        <div className="panel px-6 py-16 text-center">
          <p className="text-sm text-dim">This folder is empty.</p>
        </div>
      ) : (
        <>
          <ul className="panel divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-lift/50">
                <button
                  onClick={() => (entry.isFolder ? openFolder(entry.id) : setPreview(entry))}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {entry.isFolder ? (
                    <Folder className="h-4 w-4 shrink-0 text-dim" strokeWidth={1.75} />
                  ) : (
                    <FileIcon mimeType={entry.mimeType} />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm">{entry.name}</span>
                      {/* Marks the subset the pool already tracks. */}
                      {entry.managed && (
                        <span
                          title="9Drive tracks this file"
                          className="readout shrink-0 rounded-sm border border-flow/40 px-1 py-px text-[9px] text-flow"
                        >
                          POOLED
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-faint">
                      {entry.isFolder ? (
                        'Folder'
                      ) : (
                        <span className="readout">{entry.size ? formatBytes(entry.size) : '—'}</span>
                      )}
                      {entry.modifiedTime && ` · ${formatRelative(entry.modifiedTime)}`}
                    </span>
                  </span>
                </button>

                {!entry.isFolder && (
                  <a
                    href={`/api/drives/${accountId}/content/${encodeURIComponent(entry.id)}?download=1`}
                    title={`Download ${entry.name}`}
                    className="shrink-0 rounded-sm p-1.5 text-dim opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </a>
                )}
              </li>
            ))}
          </ul>

          {data?.nextPageToken && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-line py-2.5 text-xs text-dim transition-colors hover:border-line-bright hover:text-ink disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
              Load more
            </button>
          )}
        </>
      )}

      {preview && <DrivePreview entry={preview} accountId={accountId} onClose={() => setPreview(null)} />}
    </div>
  )
}
