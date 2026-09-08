'use client'

import { create } from 'zustand'
import { api } from './api'

/**
 * Browser-to-Drive uploader.
 *
 * The server hands back a resumable session URI; from there the bytes go
 * straight from this tab to googleapis.com. Nothing transits our own
 * infrastructure, which is what makes multi-gigabyte uploads possible on a
 * serverless deployment.
 *
 * Google's resumable protocol, condensed:
 *   PUT <uri>  Content-Range: bytes 0-8388607/52428800   -> 308, keep going
 *   PUT <uri>  Content-Range: bytes 8388608-.../52428800 -> 308 ...
 *   PUT <uri>  ...final chunk...                          -> 200 + file JSON
 *   PUT <uri>  Content-Range: bytes *​/52428800            -> ask where we are
 */

/** Google requires every chunk except the last to be a multiple of 256 KiB. */
const CHUNK_SIZE = 8 * 1024 * 1024
const MAX_ATTEMPTS = 5

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'done' | 'error' | 'cancelled'

export type UploadItem = {
  id: string
  file: File
  name: string
  sizeBytes: number
  uploadedBytes: number
  status: UploadStatus
  /** Which account routing chose, shown live so the routing is legible. */
  accountEmail?: string
  reason?: string
  error?: string
  sessionId?: string
  uploadUrl?: string
  bytesPerSecond: number
}

type UploadState = {
  items: UploadItem[]
  open: boolean
  enqueue: (files: File[], folderId: string | null) => Promise<void>
  cancel: (id: string) => void
  dismiss: (id: string) => void
  clearFinished: () => void
  setOpen: (open: boolean) => void
}

const cancelled = new Set<string>()

function nextId() {
  return Math.random().toString(36).slice(2, 10)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Asks Google how many bytes it actually holds, so a retry resumes correctly. */
async function probeOffset(uploadUrl: string, total: number): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}` },
  })
  if (res.status === 200 || res.status === 201) return total
  if (res.status === 308) {
    const range = res.headers.get('Range')
    if (!range) return 0
    const end = Number(range.split('-')[1])
    return Number.isFinite(end) ? end + 1 : 0
  }
  throw new Error(`Could not resume the upload (${res.status}).`)
}

type InitResult =
  | { ok: true; name: string; sessionId: string; uploadUrl: string; account: { email: string }; reason: string }
  | { ok: false; name: string; error: string }

export const useUploads = create<UploadState>((set) => ({
  items: [],
  open: false,

  setOpen: (open) => set({ open }),

  cancel: (id) => {
    cancelled.add(id)
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, status: 'cancelled' } : i)) }))
  },

  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  clearFinished: () =>
    set((s) => ({ items: s.items.filter((i) => !['done', 'error', 'cancelled'].includes(i.status)) })),

  enqueue: async (files, folderId) => {
    if (files.length === 0) return

    const items: UploadItem[] = files.map((file) => ({
      id: nextId(),
      file,
      name: file.name,
      sizeBytes: file.size,
      uploadedBytes: 0,
      status: 'preparing',
      bytesPerSecond: 0,
    }))

    set((s) => ({ items: [...items, ...s.items], open: true }))

    const patch = (id: string, next: Partial<UploadItem>) =>
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...next } : i)) }))

    // One round trip routes the whole batch, so the reservation ledger can
    // stop several large files landing on the same account.
    let results: InitResult[]
    try {
      const response = await api<{ results: InitResult[] }>('/api/uploads/init', {
        method: 'POST',
        body: JSON.stringify({
          files: items.map((i) => ({
            name: i.name,
            mimeType: i.file.type || 'application/octet-stream',
            sizeBytes: String(i.sizeBytes),
            folderId,
          })),
        }),
      })
      results = response.results
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start the upload.'
      items.forEach((i) => patch(i.id, { status: 'error', error: message }))
      return
    }

    // Uploads run one at a time: parallel streams to Drive mostly compete for
    // the same uplink, and serialising keeps the progress readout honest.
    for (const [index, item] of items.entries()) {
      const plan = results[index]
      if (!plan?.ok) {
        patch(item.id, { status: 'error', error: plan?.error ?? 'Could not prepare this upload.' })
        continue
      }
      if (cancelled.has(item.id)) continue

      patch(item.id, {
        status: 'uploading',
        sessionId: plan.sessionId,
        uploadUrl: plan.uploadUrl,
        accountEmail: plan.account.email,
        reason: plan.reason,
      })

      try {
        const providerFileId = await pushChunks(item, plan.uploadUrl, (uploadedBytes, bytesPerSecond) =>
          patch(item.id, { uploadedBytes, bytesPerSecond }),
        )
        await api('/api/uploads/complete', {
          method: 'POST',
          body: JSON.stringify({ sessionId: plan.sessionId, providerFileId }),
        })
        patch(item.id, { status: 'done', uploadedBytes: item.sizeBytes })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed.'
        const wasCancelled = cancelled.has(item.id)
        patch(item.id, { status: wasCancelled ? 'cancelled' : 'error', error: wasCancelled ? undefined : message })
        await api('/api/uploads/complete', {
          method: 'POST',
          body: JSON.stringify({ sessionId: plan.sessionId, failed: true, error: message }),
        }).catch(() => undefined)
      }
    }

    // Let the rest of the app pick up the new files and the new quota.
    window.dispatchEvent(new CustomEvent('9drive:refresh'))
  },
}))

function pushChunks(
  item: UploadItem,
  uploadUrl: string,
  onProgress: (uploadedBytes: number, bytesPerSecond: number) => void,
): Promise<string> {
  return uploadBlobInChunks(item.file, uploadUrl, {
    onProgress,
    isCancelled: () => cancelled.has(item.id),
  })
}

/**
 * The resumable protocol itself, over any Blob.
 *
 * Split out from the queue above because the vault needs it: an encrypted file
 * is just a Blob of ciphertext, and Google's resumable endpoint does not care
 * what the bytes are. Same chunking, same 308 handling, same resume-on-drop.
 */
export async function uploadBlobInChunks(
  blob: Blob,
  uploadUrl: string,
  options: {
    onProgress?: (uploadedBytes: number, bytesPerSecond: number) => void
    isCancelled?: () => boolean
  } = {},
): Promise<string> {
  const onProgress = options.onProgress ?? (() => undefined)
  const isCancelled = options.isCancelled ?? (() => false)
  const total = blob.size
  let offset = 0
  let attempts = 0
  const startedAt = Date.now()

  while (offset < total) {
    if (isCancelled()) throw new Error('Cancelled')

    const end = Math.min(offset + CHUNK_SIZE, total)
    const chunk = blob.slice(offset, end)

    let res: Response
    try {
      res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
        body: chunk,
      })
    } catch {
      // Connection dropped mid-chunk. Ask Google where it got to and continue.
      if (++attempts > MAX_ATTEMPTS) throw new Error('The connection kept dropping. Try again.')
      await sleep(2 ** attempts * 250)
      offset = await probeOffset(uploadUrl, total)
      onProgress(offset, 0)
      continue
    }

    if (res.status === 308) {
      const range = res.headers.get('Range')
      offset = range ? Number(range.split('-')[1]) + 1 : end
      attempts = 0
      const elapsed = (Date.now() - startedAt) / 1000
      onProgress(offset, elapsed > 0 ? offset / elapsed : 0)
      continue
    }

    if (res.status === 200 || res.status === 201) {
      onProgress(total, 0)
      const meta = (await res.json()) as { id?: string }
      if (!meta.id) throw new Error('Google accepted the file but did not return an id.')
      return meta.id
    }

    // 5xx is transient; 4xx means the session is bad and retrying will not help.
    if (res.status >= 500 && ++attempts <= MAX_ATTEMPTS) {
      await sleep(2 ** attempts * 250)
      offset = await probeOffset(uploadUrl, total)
      continue
    }

    throw new Error(`Google rejected the upload (${res.status}).`)
  }

  // Every byte is up but no 200 came back — confirm the final state.
  const finalOffset = await probeOffset(uploadUrl, total)
  if (finalOffset < total) throw new Error('The upload finished short.')
  throw new Error('Google did not confirm the finished file.')
}
