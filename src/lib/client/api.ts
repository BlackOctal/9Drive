'use client'

/** Thin fetch wrapper. Auth rides on httpOnly cookies, so nothing to attach. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export type AccountSummary = {
  id: string
  bayIndex: number
  email: string
  displayName: string | null
  avatarUrl: string | null
  status: string
  lastError: string | null
  fileCount: number
  /** Vault files on this drive. Disconnecting makes them unrecoverable. */
  secretFileCount: number
  connectedAt: string
  quota: {
    totalBytes: string | null
    usedBytes: string | null
    availableBytes: string | null
    trashBytes: string | null
    lastSyncedAt: string | null
  }
}

export type Bay = {
  index: number
  state: 'online' | 'degraded' | 'empty' | 'locked'
  accountId: string | null
  email: string | null
  totalBytes: string | null
  usedBytes: string | null
  lastSyncedAt: string | null
  lastError: string | null
  dedicatedCredentials: boolean
  lockedReason: string | null
}

export type ArrayStatus = {
  volume: {
    totalBytes: string
    usedBytes: string
    availableBytes: string
    fileCount: number
    uploadsToday: number
  }
  bays: Bay[]
  chassisSize: number
  onlineCount: number
  degradedCount: number
  nextTarget: { accountId: string; email: string; reason: string } | null
  breakdown: Array<{ kind: string; bytes: string; count: number }>
}

export type StorageSummary = {
  totalBytes: string
  usedBytes: string
  availableBytes: string
  accountCount: number
  fileCount: number
  nextTarget: { accountId: string; email: string; reason: string; eligibleCount: number } | null
  breakdown: Array<{ kind: string; bytes: string; count: number }>
}

export type FileRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  starred: boolean
  folderId: string | null
  account: { id: string; email: string; bayIndex: number }
  createdAt: string
  updatedAt: string
}

/** One entry as it exists in the Google account, plus what 9Drive knows of it. */
export type DriveEntry = {
  id: string
  name: string
  mimeType: string
  size: string | null
  modifiedTime: string | null
  iconLink: string | null
  videoMediaMetadata: { width?: number; height?: number; durationMillis?: string } | null
  isFolder: boolean
  /** True when a File row points at this id — i.e. the pool already tracks it. */
  managed: boolean
}

export type DriveBrowse = {
  drive: {
    id: string
    bayIndex: number
    email: string
    status: string
    quota: { totalBytes: string | null; usedBytes: string | null; availableBytes: string | null }
  }
  folderId: string
  breadcrumbs: Array<{ id: string; name: string }>
  entries: DriveEntry[]
  nextPageToken: string | null
}

/** One vault row. Everything identifying about it is ciphertext. */
export type SecretFileRow = {
  id: string
  encryptedName: string
  encryptedFileKey: string
  iv: string
  sizeBytes: string | null
  createdAt: string
  /** False when the app data folder no longer holds it — unrecoverable. */
  present: boolean
}

export type VaultState = {
  configured: boolean
  salt: string | null
  verifier: string | null
  readyDriveCount: number
  /** Drives whose grant predates the app data scope; they must be reconnected. */
  needsReconnect: Array<{ id: string; email: string; bayIndex: number }>
  files: SecretFileRow[]
}
