'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Download,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Plug,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, type SecretFileRow, type VaultState } from '@/lib/client/api'
import { invalidate, useCachedResource } from '@/lib/client/cache'
import { uploadBlobInChunks } from '@/lib/client/uploader'
import {
  checkVerifier,
  decryptFile,
  decryptName,
  deriveVaultKey,
  encryptFile,
  makeVerifier,
  newSalt,
  MAX_VAULT_FILE_BYTES,
} from '@/lib/client/vault'
import { formatBytes, formatDate } from '@/lib/bytes'
import { cn } from '@/lib/cn'

/** The key is dropped after this much inactivity. Re-entering it is the cost. */
const IDLE_LOCK_MS = 15 * 60_000

/**
 * The secret space.
 *
 * Two separate protections, doing two different jobs. The app data folder
 * hides these files from the Drive interface and from every other app — that
 * is a visibility measure, and only a visibility measure. The encryption is
 * what actually protects them: contents and filenames are AES-256-GCM
 * ciphertext produced in this tab, under a key derived from a passphrase the
 * server never receives.
 *
 * The derived key lives in this component's state and nowhere else. No
 * localStorage, no cookie, no store that survives a reload. Refreshing the
 * page loses it and the passphrase has to be entered again — that is the
 * design, not a rough edge.
 */
export default function VaultPage() {
  // Cached like any other page. Everything in this payload is ciphertext or a
  // public parameter, so nothing sensitive is being held — the derived key is
  // the secret, and that never leaves component state.
  const { data: state, refresh } = useCachedResource('vault', () => api<VaultState>('/api/vault'))
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    await refresh()
  }, [refresh])

  const lock = useCallback((reason?: string) => {
    setVaultKey(null)
    setNames({})
    if (reason) setNotice(reason)
  }, [])

  // Idle auto-lock. Activity is sampled rather than debounced per event —
  // a timestamp write on every keystroke is not worth the churn.
  const lastActive = useRef(Date.now())
  useEffect(() => {
    if (!vaultKey) return
    const touch = () => {
      lastActive.current = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LOCK_MS) lock('Locked after 15 minutes idle.')
    }, 15_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      clearInterval(timer)
    }
  }, [vaultKey, lock])

  // Names are ciphertext on the wire; they only become readable here.
  useEffect(() => {
    if (!vaultKey || !state) return
    let cancelled = false
    void (async () => {
      const resolved: Record<string, string> = {}
      for (const file of state.files) {
        try {
          resolved[file.id] = await decryptName(vaultKey, file)
        } catch {
          resolved[file.id] = 'Could not decrypt this name'
        }
      }
      if (!cancelled) setNames(resolved)
    })()
    return () => {
      cancelled = true
    }
  }, [vaultKey, state])

  if (!state) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 animate-pulse rounded-sm bg-lift" />
        <div className="h-48 animate-pulse rounded-sm bg-lift" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-tight">
            <Lock className="h-5 w-5 text-vault" strokeWidth={1.75} />
            Vault
          </h1>
          <p className="mt-1 text-sm text-dim">
            Encrypted in your browser, hidden from the Google Drive interface.
          </p>
        </div>

        {vaultKey && (
          <button
            onClick={() => lock('Locked.')}
            className="flex items-center gap-2 rounded-sm border border-vault-dim px-3 py-2 text-xs text-vault transition-colors hover:bg-vault/10"
          >
            <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
            Lock
          </button>
        )}
      </header>

      {notice && !vaultKey && (
        <p className="vault-panel px-4 py-2.5 text-xs text-vault">{notice}</p>
      )}

      {state.needsReconnect.length > 0 && <ReconnectNotice drives={state.needsReconnect} />}

      {!state.configured ? (
        <SetupPanel
          onDone={(key) => {
            setNotice(null)
            setVaultKey(key)
            void load()
          }}
        />
      ) : !vaultKey ? (
        <UnlockPanel
          salt={state.salt!}
          verifier={state.verifier!}
          onUnlock={(key) => {
            setNotice(null)
            setVaultKey(key)
          }}
        />
      ) : (
        <UnlockedVault
          state={state}
          vaultKey={vaultKey}
          names={names}
          reload={load}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ notices */

/**
 * The app data scope was added after the first drives were connected, so an
 * older grant does not carry it. Saying so beats letting Google return a 403
 * the user cannot interpret.
 */
function ReconnectNotice({ drives }: { drives: VaultState['needsReconnect'] }) {
  return (
    <div className="vault-panel flex flex-wrap items-start gap-3 px-4 py-3.5">
      <Plug className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {drives.length === 1 ? 'One drive has' : `${drives.length} drives have`} not granted app data access
          yet.
        </p>
        <p className="mt-1 text-xs text-dim">
          The vault needs a permission these drives were connected before. Reconnect{' '}
          {drives.map((d) => d.email).join(', ')} to make {drives.length === 1 ? 'it' : 'them'} usable for
          secret files. Nothing already stored is affected.
        </p>
      </div>
      <a
        href="/api/auth/google/url?flow=connect&redirect=1&returnTo=/vault"
        className="shrink-0 rounded-sm border border-vault-dim px-2.5 py-1.5 text-xs text-vault transition-colors hover:bg-vault/10"
      >
        Reconnect
      </a>
    </div>
  )
}

function Warning({ icon: Icon, title, children }: { icon: typeof ShieldAlert; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-l-2 border-warn/50 pl-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.75} />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-dim">{children}</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- setup */

function SetupPanel({ onDone }: { onDone: (key: CryptoKey) => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase.length < 10) return setError('Use at least 10 characters.')
    if (passphrase !== confirm) return setError('Those two do not match.')

    setBusy(true)
    setError(null)
    try {
      const salt = newSalt()
      const key = await deriveVaultKey(passphrase, salt)
      const verifier = await makeVerifier(key)
      // Only the salt and the verifier leave this tab.
      await api('/api/vault/setup', { method: 'POST', body: JSON.stringify({ salt, verifier }) })
      onDone(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up the vault.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vault-panel mx-auto max-w-xl p-6">
      <span className="eyebrow text-vault-dim">Set up</span>
      <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Choose a passphrase</h2>

      {/* Both warnings come before the form. Reading them after choosing a
          passphrase would be reading them too late. */}
      <div className="mt-5 space-y-4">
        <Warning icon={KeyRound} title="There is no reset">
          Your passphrase is the only thing that can decrypt these files. It is never sent to the server, so
          nobody — including us — can recover it for you. Forget it and the files are gone for good.
        </Warning>
        <Warning icon={ShieldAlert} title="Disconnecting a drive destroys its vault contents">
          Secret files live in a folder Google keeps for this app alone. If you remove 9Drive from a Google
          account&rsquo;s permissions, Google deletes that folder outright. Encrypted contents cannot be
          recovered from anywhere else. Know that before you store anything here.
        </Warning>
      </div>

      <form onSubmit={create} className="mt-6 space-y-3">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoComplete="new-password"
          className="w-full rounded-sm border border-vault-dim/60 bg-void px-3 py-2.5 text-sm placeholder:text-faint focus:border-vault"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Passphrase again"
          autoComplete="new-password"
          className="w-full rounded-sm border border-vault-dim/60 bg-void px-3 py-2.5 text-sm placeholder:text-faint focus:border-vault"
        />
        {error && <p className="text-xs text-alarm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-vault px-3 py-2.5 text-sm font-semibold text-void transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {busy ? 'Deriving key…' : 'Create vault'}
        </button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------- unlock */

function UnlockPanel({
  salt,
  verifier,
  onUnlock,
}: {
  salt: string
  verifier: string
  onUnlock: (key: CryptoKey) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const key = await deriveVaultKey(passphrase, salt)
      // The verifier is what turns a wrong passphrase into a clean rejection
      // rather than a pile of files that decrypt to noise.
      if (!(await checkVerifier(key, verifier))) {
        setError('That passphrase is not right.')
        return
      }
      setPassphrase('')
      onUnlock(key)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vault-panel mx-auto max-w-md p-6 text-center">
      <Lock className="mx-auto h-6 w-6 text-vault-dim" strokeWidth={1.5} />
      <h2 className="mt-3 font-display text-lg font-semibold tracking-tight">Locked</h2>
      <p className="mt-1 text-xs text-dim">The key is held in memory only, so it is gone after a refresh.</p>

      <form onSubmit={unlock} className="mt-5 space-y-3">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoComplete="current-password"
          autoFocus
          className="w-full rounded-sm border border-vault-dim/60 bg-void px-3 py-2.5 text-center text-sm placeholder:text-faint focus:border-vault"
        />
        {error && <p className="text-xs text-alarm">{error}</p>}
        <button
          type="submit"
          disabled={busy || passphrase.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-vault px-3 py-2.5 text-sm font-semibold text-void transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <LockOpen className="h-4 w-4" strokeWidth={2} />}
          {busy ? 'Deriving key…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}

/* ----------------------------------------------------------------- unlocked */

type Busy = { label: string; pct: number } | null

function UnlockedVault({
  state,
  vaultKey,
  names,
  reload,
}: {
  state: VaultState
  vaultKey: CryptoKey
  names: Record<string, string>
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const blocked = state.readyDriveCount === 0

  async function upload(file: File) {
    setError(null)
    if (file.size > MAX_VAULT_FILE_BYTES) {
      setError(`${file.name} is larger than the 100 MB limit for secret files.`)
      return
    }

    let sessionId: string | null = null
    try {
      // Encrypt first: the uploader below only ever sees ciphertext.
      setBusy({ label: 'Encrypting…', pct: 0 })
      const { blob, envelope, sizeBytes } = await encryptFile(vaultKey, file)

      const init = await api<{ sessionId: string; uploadUrl: string }>('/api/vault/uploads/init', {
        method: 'POST',
        body: JSON.stringify({ sizeBytes: String(sizeBytes) }),
      })
      sessionId = init.sessionId

      setBusy({ label: 'Uploading…', pct: 0 })
      const providerFileId = await uploadBlobInChunks(blob, init.uploadUrl, {
        onProgress: (uploaded) => setBusy({ label: 'Uploading…', pct: (uploaded / blob.size) * 100 }),
      })

      await api('/api/vault/uploads/complete', {
        method: 'POST',
        body: JSON.stringify({ sessionId: init.sessionId, providerFileId, ...envelope }),
      })
      // Vault files consume quota, so the array and drive readings have moved.
      invalidate()
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.'
      setError(message)
      if (sessionId) {
        await api('/api/vault/uploads/complete', {
          method: 'POST',
          body: JSON.stringify({ sessionId, failed: true, error: message }),
        }).catch(() => undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  async function download(file: SecretFileRow) {
    setError(null)
    try {
      setBusy({ label: 'Downloading…', pct: 0 })
      const res = await fetch(`/api/vault/files/${file.id}/content`)
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? 'Could not fetch that file.')
      }

      setBusy({ label: 'Decrypting…', pct: 0 })
      const plain = await decryptFile(vaultKey, file, await res.arrayBuffer())

      const url = URL.createObjectURL(plain)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = names[file.id] ?? 'secret-file'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decrypt that file.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api(`/api/vault/files/${id}`, { method: 'DELETE' })
      setConfirming(null)
      invalidate()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that file.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-dim">
          {state.files.length} {state.files.length === 1 ? 'file' : 'files'} · encrypted before upload, capped
          at 100 MB each
        </p>

        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void upload(file)
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(busy) || blocked}
          title={blocked ? 'No drive has granted app data access yet.' : undefined}
          className="flex items-center gap-2 rounded-sm border border-vault-dim px-3 py-2 text-xs text-vault transition-colors hover:bg-vault/10 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add file
        </button>
      </div>

      {busy && (
        <div className="vault-panel px-4 py-3">
          <p className="flex items-center gap-2 text-xs text-vault">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {busy.label}
          </p>
          {busy.pct > 0 && (
            <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-vault/15">
              <span className="block h-full bg-vault transition-[width]" style={{ width: `${busy.pct}%` }} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="vault-panel flex items-start gap-2 px-4 py-3 text-xs text-alarm">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}

      {state.files.length === 0 ? (
        <div className="vault-panel px-6 py-16 text-center">
          <p className="mx-auto max-w-sm text-sm text-dim">
            Nothing here. Files added to the vault are encrypted in this tab first — a file has to be uploaded
            straight in, because Google does not allow moving anything into this folder.
          </p>
        </div>
      ) : (
        <ul className="vault-panel divide-y divide-vault-dim/25">
          {state.files.map((file) => (
            <li key={file.id} className="group flex items-center gap-3 px-4 py-3">
              <Lock className="h-3.5 w-3.5 shrink-0 text-vault-dim" strokeWidth={1.75} />

              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm', !names[file.id] && 'text-faint')}>
                  {names[file.id] ?? 'Decrypting…'}
                </p>
                <p className="mt-0.5 truncate text-xs text-faint">
                  <span className="readout">{formatBytes(file.sizeBytes)}</span> · {formatDate(file.createdAt)}
                  {!file.present && ' · missing from Drive'}
                </p>
              </div>

              {confirming === file.id ? (
                <div className="flex items-center gap-2">
                  {/* No trash flow exists for this folder — Google deletes
                      immediately and there is nothing to restore from. */}
                  <span className="text-xs text-dim">Delete permanently? This cannot be undone.</span>
                  <button
                    onClick={() => remove(file.id)}
                    className="rounded-sm bg-alarm px-2.5 py-1.5 text-xs font-semibold text-void"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="rounded-sm border border-vault-dim px-2.5 py-1.5 text-xs text-dim hover:text-ink"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => void download(file)}
                    disabled={Boolean(busy) || !file.present}
                    title={file.present ? 'Download and decrypt' : 'No longer in the drive'}
                    className="rounded-sm p-1.5 text-dim transition-colors hover:text-vault disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={() => setConfirming(file.id)}
                    title="Delete permanently"
                    className="rounded-sm p-1.5 text-dim transition-colors hover:text-alarm"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
