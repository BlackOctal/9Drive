import type { ConnectedAccount } from '@prisma/client'
import { APPDATA_SCOPE, credentialsForBay, GOOGLE_REDIRECT_URI, GOOGLE_SCOPES } from '../env'
import { prisma } from '../prisma'
import { decrypt, encrypt } from '../crypto'

/**
 * Google Drive over plain fetch.
 *
 * The `googleapis` package is ~50MB and pulls in a discovery layer we don't
 * need; on a serverless target that is cold-start weight for four endpoints.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const APP_FOLDER_NAME = '9drive'

export function buildConsentUrl(state: string, bay: number, options: { forceConsent?: boolean } = {}) {
  const params = new URLSearchParams({
    client_id: credentialsForBay(bay).clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    // Without this Google withholds the refresh token on re-consent, and an
    // account with no refresh token is dead the moment its hour is up.
    prompt: options.forceConsent === false ? 'select_account' : 'consent select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

export async function exchangeCode(code: string, bay: number): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentialsForBay(bay)
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google rejected the authorization code: ${await res.text()}`)
  return res.json()
}

export type GoogleProfile = { id: string; email: string; name?: string; picture?: string }

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Could not read the Google profile.')
  return res.json()
}

/**
 * Returns a usable access token for an account, refreshing it if it is within
 * a minute of expiry. The refreshed token is written back encrypted.
 */
export async function getAccessToken(account: ConnectedAccount): Promise<string> {
  if (account.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(account.accessTokenEncrypted)
  }

  // Refresh must use the same client that issued the token, so it is keyed
  // to the bay the drive sits in.
  const { clientId, clientSecret } = credentialsForBay(account.bayIndex)
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(account.refreshTokenEncrypted),
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const message = await res.text()
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { status: 'reauth_required', lastError: `Token refresh failed: ${message.slice(0, 400)}` },
    })
    throw new Error(`${account.email} needs to be reconnected.`)
  }

  const tokens: TokenResponse = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encrypt(tokens.access_token),
      tokenExpiresAt: expiresAt,
      status: 'connected',
      lastError: null,
    },
  })
  return tokens.access_token
}

async function driveFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 500)}`)
  return res
}

export type QuotaSnapshot = {
  totalBytes: bigint | null
  usedBytes: bigint
  availableBytes: bigint | null
  trashBytes: bigint | null
}

export async function fetchQuota(account: ConnectedAccount): Promise<QuotaSnapshot> {
  const token = await getAccessToken(account)
  const res = await driveFetch(token, '/about?fields=storageQuota')
  const { storageQuota } = (await res.json()) as {
    storageQuota?: { limit?: string; usage?: string; usageInDriveTrash?: string }
  }
  const total = storageQuota?.limit ? BigInt(storageQuota.limit) : null
  const used = storageQuota?.usage ? BigInt(storageQuota.usage) : 0n
  return {
    totalBytes: total,
    usedBytes: used,
    // Clamped: Google occasionally reports usage above limit during grace periods.
    availableBytes: total === null ? null : total - used > 0n ? total - used : 0n,
    trashBytes: storageQuota?.usageInDriveTrash ? BigInt(storageQuota.usageInDriveTrash) : null,
  }
}

/** Writes a fresh quota reading to the ledger. Never throws — records the error instead. */
export async function syncQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  try {
    const snapshot = await fetchQuota(account)
    const data = { ...snapshot, lastSyncedAt: new Date() }
    await prisma.quota.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: data,
    })
    if (account.lastError) {
      await prisma.connectedAccount.update({ where: { id: accountId }, data: { lastError: null } })
    }
    return snapshot
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quota check failed'
    await prisma.connectedAccount
      .update({ where: { id: accountId }, data: { lastError: message.slice(0, 400) } })
      .catch(() => undefined)
    return null
  }
}

function escapeQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Finds or creates the `9drive` folder at the root of an account's Drive. */
export async function ensureRootFolder(account: ConnectedAccount): Promise<string> {
  if (account.rootFolderId) return account.rootFolderId
  const token = await getAccessToken(account)

  const q = [
    `name = '${escapeQuery(APP_FOLDER_NAME)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'root' in parents`,
    `trashed = false`,
  ].join(' and ')

  const found = await driveFetch(token, `/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id)&pageSize=1`)
  const existing = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id

  const folderId =
    existing ??
    (
      (await (
        await driveFetch(token, '/files?fields=id', {
          method: 'POST',
          body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }),
        })
      ).json()) as { id: string }
    ).id

  await prisma.connectedAccount.update({ where: { id: account.id }, data: { rootFolderId: folderId } })
  return folderId
}

export async function createFolder(account: ConnectedAccount, name: string, parentId: string) {
  const token = await getAccessToken(account)
  const res = await driveFetch(token, '/files?fields=id', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return ((await res.json()) as { id: string }).id
}

/**
 * Opens a resumable upload session and hands back the session URI.
 *
 * The URI is itself the credential — no Authorization header is needed on the
 * chunk PUTs — which is what lets the browser upload straight to Google
 * without ever holding an OAuth token, and without a byte crossing our server.
 */
export async function createResumableSession(
  account: ConnectedAccount,
  file: { name: string; mimeType: string; sizeBytes: bigint; parentId: string },
  origin: string,
): Promise<string> {
  const token = await getAccessToken(account)
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': file.mimeType,
      'X-Upload-Content-Length': file.sizeBytes.toString(),
      // Google echoes this into the session's CORS allowlist, so the browser
      // is permitted to PUT chunks to the returned URI.
      Origin: origin,
    },
    body: JSON.stringify({ name: file.name, parents: [file.parentId] }),
  })

  if (!res.ok) throw new Error(`Could not start the upload: ${(await res.text()).slice(0, 400)}`)
  const location = res.headers.get('location')
  if (!location) throw new Error('Google did not return an upload session.')
  return location
}

export async function getFileMetadata(account: ConnectedAccount, providerFileId: string) {
  const token = await getAccessToken(account)
  const res = await driveFetch(token, `/files/${providerFileId}?fields=id,name,mimeType,size,md5Checksum`)
  return (await res.json()) as { id: string; name: string; mimeType: string; size?: string }
}

export async function renameRemoteFile(account: ConnectedAccount, providerFileId: string, name: string) {
  const token = await getAccessToken(account)
  await driveFetch(token, `/files/${providerFileId}?fields=id`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function trashRemoteFile(account: ConnectedAccount, providerFileId: string) {
  const token = await getAccessToken(account)
  await driveFetch(token, `/files/${providerFileId}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  })
}

export async function deleteRemoteFile(account: ConnectedAccount, providerFileId: string) {
  const token = await getAccessToken(account)
  await driveFetch(token, `/files/${providerFileId}`, { method: 'DELETE' })
}

/** Native Google formats have no bytes to download; they must be exported. */
export const EXPORT_FORMATS: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: '.xlsx',
  },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

/**
 * Opens a byte stream for a file, forwarding the caller's Range header so
 * video seeking produces a real 206 rather than a full re-download.
 */
export async function openFileStream(
  account: ConnectedAccount,
  providerFileId: string,
  mimeType: string,
  range?: string | null,
) {
  const token = await getAccessToken(account)
  const exportAs = EXPORT_FORMATS[mimeType]
  const url = exportAs
    ? `${DRIVE_API}/files/${providerFileId}/export?mimeType=${encodeURIComponent(exportAs.mimeType)}`
    : `${DRIVE_API}/files/${providerFileId}?alt=media`

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Exports are generated on the fly and cannot be range-served.
      ...(range && !exportAs ? { Range: range } : {}),
    },
  })
}

/**
 * A raw entry as Drive reports it, before 9Drive decides what it means.
 *
 * `size` is absent on folders and on Google-native types, which occupy no
 * bytes of their own. It arrives as a JSON string and stays one — byte counts
 * never become numbers on the way through.
 */
export type DriveEntry = {
  id: string
  name: string
  mimeType: string
  size: string | null
  modifiedTime: string | null
  iconLink: string | null
  videoMediaMetadata: { width?: number; height?: number; durationMillis?: string } | null
}

export type Crumb = { id: string; name: string }

/** How deep the parent walk will go before assuming the graph is malformed. */
const MAX_BREADCRUMB_DEPTH = 20

const LIST_FIELDS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, videoMediaMetadata)'

/**
 * Lists one folder of an account's Drive, live.
 *
 * This deliberately does not consult the local database. It reports what is
 * actually in the account — including files that predate 9Drive or were put
 * there by other means — which is the whole point of the drive browser.
 */
export async function listFolder(
  account: ConnectedAccount,
  folderId: string = 'root',
  pageToken?: string,
): Promise<{ files: DriveEntry[]; nextPageToken: string | null }> {
  const token = await getAccessToken(account)

  const params = new URLSearchParams({
    q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
    fields: LIST_FIELDS,
    // Folders first, then alphabetical — the order a file manager implies.
    orderBy: 'folder,name',
    pageSize: '100',
    spaces: 'drive',
    supportsAllDrives: 'false',
  })
  if (pageToken) params.set('pageToken', pageToken)

  const res = await driveFetch(token, `/files?${params}`)
  const body = (await res.json()) as {
    nextPageToken?: string
    files?: Array<Partial<DriveEntry> & { id: string; name: string; mimeType: string }>
  }

  return {
    files: (body.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ?? null,
      modifiedTime: f.modifiedTime ?? null,
      iconLink: f.iconLink ?? null,
      videoMediaMetadata: f.videoMediaMetadata ?? null,
    })),
    nextPageToken: body.nextPageToken ?? null,
  }
}

/**
 * Walks up the parent chain so the browser can show a path.
 *
 * Drive omits `parents` on the root itself, which is what ends the walk. The
 * depth is capped anyway: a malformed graph — or a shortcut cycle — would
 * otherwise loop until the function times out.
 */
export async function getBreadcrumbs(account: ConnectedAccount, folderId: string = 'root'): Promise<Crumb[]> {
  const root: Crumb = { id: 'root', name: 'My Drive' }
  if (!folderId || folderId === 'root') return [root]

  const token = await getAccessToken(account)
  const trail: Crumb[] = []
  const seen = new Set<string>()
  let cursor: string | null = folderId

  for (let depth = 0; cursor && depth < MAX_BREADCRUMB_DEPTH; depth++) {
    // A cycle would otherwise spend the whole depth budget re-fetching.
    if (seen.has(cursor)) break
    seen.add(cursor)

    let node: { id: string; name: string; parents?: string[] }
    try {
      const res = await driveFetch(token, `/files/${encodeURIComponent(cursor)}?fields=id,name,parents`)
      node = await res.json()
    } catch {
      // A parent we cannot read is still a path we can partially describe.
      break
    }

    const parent: string | undefined = node.parents?.[0]
    // The node with no parent is the root; label it ourselves so the crumb
    // links back to the root listing rather than to a raw file id.
    if (!parent) break

    trail.unshift({ id: node.id, name: node.name })
    cursor = parent
  }

  return [root, ...trail]
}

/* ---------------------------------------------------------------- app data */

/**
 * Google's appDataFolder: a per-app folder that does not appear in the Drive
 * interface and is invisible to every other Drive app.
 *
 * Three constraints come with it, and the code around it has to respect all
 * three:
 *
 *   1. Its files cannot be trashed. DELETE is immediate and permanent, so the
 *      vault offers no trash flow.
 *   2. Files cannot be moved in or out. There is no "move to the vault" — a
 *      file has to be uploaded into it directly.
 *   3. It still consumes the account's quota, so vault files stay part of the
 *      volume's used total.
 *
 * It is also deleted outright if the user disconnects 9Drive from their Google
 * account, which for encrypted contents means unrecoverable. The UI says so
 * before anything is stored.
 */
export const APP_DATA_FOLDER = 'appDataFolder'

/**
 * True when this account's grant actually includes the app data scope.
 *
 * The scope was added after the first drives were connected, so an existing
 * account's stored grant may predate it. Checking here lets the vault ask for
 * a reconnect instead of surfacing a raw 403 from Google.
 */
export function accountHasVaultScope(account: ConnectedAccount): boolean {
  return account.scopes.includes(APPDATA_SCOPE)
}

/**
 * Opens a resumable session that lands in the app data folder.
 *
 * `name` should already be an opaque id: the real filename is encrypted and
 * kept in the database, and anything readable here would defeat the point.
 */
export async function createVaultUploadSession(
  account: ConnectedAccount,
  file: { name: string; sizeBytes: bigint },
  origin: string,
): Promise<string> {
  const token = await getAccessToken(account)
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Ciphertext is opaque bytes; claiming any other type would be a lie.
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': file.sizeBytes.toString(),
      Origin: origin,
    },
    body: JSON.stringify({
      name: file.name,
      mimeType: 'application/octet-stream',
      parents: [APP_DATA_FOLDER],
    }),
  })

  if (!res.ok) throw new Error(`Could not start the upload: ${(await res.text()).slice(0, 400)}`)
  const location = res.headers.get('location')
  if (!location) throw new Error('Google did not return an upload session.')
  return location
}

/** Lists the app data folder. Ids and sizes only — there is nothing else there. */
export async function listAppDataFiles(
  account: ConnectedAccount,
): Promise<Array<{ id: string; name: string; size: string | null }>> {
  const token = await getAccessToken(account)
  const params = new URLSearchParams({
    spaces: APP_DATA_FOLDER,
    fields: 'files(id, name, size)',
    pageSize: '1000',
  })
  const res = await driveFetch(token, `/files?${params}`)
  const body = (await res.json()) as { files?: Array<{ id: string; name: string; size?: string }> }
  return (body.files ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size ?? null }))
}

/** Opens the ciphertext stream for a vault file. No Range: decryption needs all of it. */
export async function openVaultFileStream(account: ConnectedAccount, providerFileId: string) {
  const token = await getAccessToken(account)
  return fetch(`${DRIVE_API}/files/${encodeURIComponent(providerFileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
