'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * A small stale-while-revalidate cache for page data.
 *
 * Every page in this app fetches in an effect and shows a skeleton until the
 * response lands, so leaving a tab and coming back paid the full round trip
 * again — and `/api/array` in particular can spend seconds re-reading quota
 * from Google. Nothing about that data was actually gone; it was just thrown
 * away with the component.
 *
 * So the cache lives at module scope rather than in a component. Returning to
 * a page paints the last known reading immediately and revalidates behind it.
 * The skeleton is then reserved for its one honest use: the first time you
 * have never seen the data at all.
 *
 * Deliberately not a library. The whole contract is four fields and a Map.
 */

export type CacheEntry<T> = {
  data: T | undefined
  error: Error | undefined
  /** When `data` was last written. 0 means "must revalidate", not "no data". */
  at: number
  /** A request is in flight for this key. */
  pending: boolean
}

const EMPTY: CacheEntry<unknown> = { data: undefined, error: undefined, at: 0, pending: false }

const store = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function read<T>(key: string): CacheEntry<T> {
  return (store.get(key) as CacheEntry<T> | undefined) ?? (EMPTY as CacheEntry<T>)
}

function write<T>(key: string, patch: Partial<CacheEntry<T>>) {
  store.set(key, { ...read<T>(key), ...patch })
  listeners.get(key)?.forEach((notify) => notify())
}

/**
 * Fetches a key, collapsing concurrent callers onto one request.
 *
 * Without the dedupe, mounting two components on the same key — or a mount
 * racing the interval — fires the same expensive request twice.
 */
export function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T | undefined> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T | undefined>

  write<T>(key, { pending: true })
  const request = fetcher()
    .then((data) => {
      write<T>(key, { data, error: undefined, at: Date.now(), pending: false })
      return data
    })
    .catch((error: unknown) => {
      // The previous data is kept. A failed refresh should not blank a page
      // that was rendering fine a moment ago.
      write<T>(key, { error: error instanceof Error ? error : new Error(String(error)), pending: false })
      return undefined
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, request)
  return request
}

/** Writes a value straight into the cache — for optimistic updates. */
export function mutate<T>(key: string, data: T) {
  write<T>(key, { data, error: undefined, at: Date.now() })
}

/**
 * Marks entries for revalidation without discarding what they hold.
 *
 * `at` goes to 0, so the next mount refetches; `data` stays, so that mount
 * still paints instantly rather than flashing a skeleton.
 */
export function invalidate(prefix?: string) {
  for (const key of store.keys()) {
    if (prefix === undefined || key.startsWith(prefix)) write(key, { at: 0 })
  }
}

/** Drops everything. Used on sign-out so the next user sees nothing of this one. */
export function clearCache() {
  store.clear()
  inflight.clear()
  for (const [, set] of listeners) set.forEach((notify) => notify())
}

// The app already announces writes this way; the cache treats it as the signal
// that every page's data is now suspect.
if (typeof window !== 'undefined') {
  window.addEventListener('9drive:refresh', () => invalidate())
}

export type UseCachedOptions = {
  /** How long a cached value is served without a background refetch. */
  staleTime?: number
  /** Poll while mounted. */
  refreshInterval?: number
  /** Refetch when the tab regains focus. */
  revalidateOnFocus?: boolean
}

/**
 * Subscribes to one cache key.
 *
 * `loading` is true only when there is genuinely nothing to show — never for a
 * background refresh over data already on screen.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { staleTime = 15_000, refreshInterval, revalidateOnFocus = true }: UseCachedOptions = {},
) {
  // Held in a ref so an inline arrow fetcher does not restart every effect.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!key) return () => undefined
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(notify)
      return () => {
        set.delete(notify)
        if (set.size === 0) listeners.delete(key)
      }
    },
    [key],
  )

  const getSnapshot = useCallback(() => (key ? read<T>(key) : (EMPTY as CacheEntry<T>)), [key])
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve(undefined)
    return revalidate<T>(key, () => fetcherRef.current())
  }, [key])

  useEffect(() => {
    if (!key) return
    // Cached and fresh: render it and make no request at all.
    if (Date.now() - read<T>(key).at > staleTime) void refresh()
  }, [key, staleTime, refresh])

  useEffect(() => {
    if (!key || !refreshInterval) return
    const timer = setInterval(() => void refresh(), refreshInterval)
    return () => clearInterval(timer)
  }, [key, refreshInterval, refresh])

  useEffect(() => {
    if (!key) return
    const onRefresh = () => void refresh()
    // The module-level listener marks every key stale so unmounted pages
    // refetch on their next visit; this one refetches the page you are
    // actually looking at, now.
    window.addEventListener('9drive:refresh', onRefresh)
    if (revalidateOnFocus) window.addEventListener('focus', onRefresh)
    return () => {
      window.removeEventListener('9drive:refresh', onRefresh)
      window.removeEventListener('focus', onRefresh)
    }
  }, [key, refresh, revalidateOnFocus])

  return {
    data: entry.data,
    error: entry.error,
    /** Nothing has ever loaded for this key. The one case a skeleton is right. */
    loading: entry.data === undefined && entry.error === undefined,
    /** Refreshing underneath data that is already on screen. */
    revalidating: entry.pending && entry.data !== undefined,
    refresh,
  }
}
