'use client'

/**
 * Vault cryptography. All of it runs in the browser.
 *
 * The server stores ciphertext, wrapped keys, and a salt. It never receives
 * the passphrase, the derived key, or a plaintext byte — which is the point:
 * hiding files in Google's app data folder keeps them out of a UI, but only
 * encryption keeps them from anyone holding the account password.
 *
 * Shape of one file:
 *
 *   fileKey        random 256-bit AES-GCM key, one per file
 *   contents       AES-256-GCM(fileKey, iv)           -> stored on Drive
 *   encryptedName  AES-256-GCM(fileKey, nameIv)       -> stored in the database
 *   encryptedFileKey  AES-256-GCM(vaultKey, wrapIv)   -> stored in the database
 *
 * The per-file key is wrapped rather than used directly so the passphrase can
 * change later by rewrapping each key, without re-encrypting any contents.
 *
 * Web Crypto only. No libraries.
 */

import { MAX_VAULT_FILE_BYTES } from '../vault-limits'

export { MAX_VAULT_FILE_BYTES }

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const VERIFIER_PLAINTEXT = '9drive-vault-verifier-v1'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  // Chunked: spreading a multi-megabyte array into apply() blows the stack.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** An AES-GCM blob is stored as one string: the IV, then the ciphertext. */
function pack(iv: Uint8Array, ciphertext: ArrayBuffer): string {
  const ct = new Uint8Array(ciphertext)
  const joined = new Uint8Array(iv.length + ct.length)
  joined.set(iv, 0)
  joined.set(ct, iv.length)
  return toBase64(joined)
}

function unpack(packed: string): { iv: Uint8Array; ciphertext: Uint8Array } {
  const bytes = fromBase64(packed)
  return { iv: bytes.subarray(0, IV_BYTES), ciphertext: bytes.subarray(IV_BYTES) }
}

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES))
}

/** A fresh per-user salt. Not secret — it stops one passphrase deriving one key everywhere. */
export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

/**
 * Passphrase -> key. 600,000 PBKDF2-SHA256 iterations, which costs a browser
 * roughly a second and costs an offline attacker the same per guess.
 *
 * The result is `extractable: false`: it can encrypt and decrypt, but nothing
 * — including our own code — can read the key material back out of it.
 */
export async function deriveVaultKey(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(saltBase64) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A known string under the derived key, so a wrong passphrase fails at once. */
export async function makeVerifier(vaultKey: CryptoKey): Promise<string> {
  const iv = randomIv()
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    vaultKey,
    encoder.encode(VERIFIER_PLAINTEXT),
  )
  return pack(iv, ct)
}

/**
 * Checks a derived key against the stored verifier.
 *
 * GCM authenticates, so a wrong key throws rather than returning noise — the
 * throw is the answer, not an error to report.
 */
export async function checkVerifier(vaultKey: CryptoKey, verifier: string): Promise<boolean> {
  try {
    const { iv, ciphertext } = unpack(verifier)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      vaultKey,
      ciphertext as BufferSource,
    )
    return decoder.decode(plain) === VERIFIER_PLAINTEXT
  } catch {
    return false
  }
}

/** The database columns describing one encrypted file. */
export type SecretEnvelope = {
  encryptedName: string
  encryptedFileKey: string
  iv: string
}

async function unwrapFileKey(vaultKey: CryptoKey, encryptedFileKey: string): Promise<CryptoKey> {
  const { iv, ciphertext } = unpack(encryptedFileKey)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    vaultKey,
    ciphertext as BufferSource,
  )
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * Encrypts a whole file in memory and returns the blob to upload plus the
 * envelope to store. The blob then goes through the ordinary chunked uploader
 * — the resumable protocol does not care what the bytes are.
 */
export async function encryptFile(
  vaultKey: CryptoKey,
  file: File,
): Promise<{ blob: Blob; envelope: SecretEnvelope; sizeBytes: number }> {
  if (file.size > MAX_VAULT_FILE_BYTES) {
    throw new Error('Secret files are capped at 100 MB.')
  }

  const rawFileKey = crypto.getRandomValues(new Uint8Array(32))
  const fileKey = await crypto.subtle.importKey('raw', rawFileKey as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])

  const contentIv = randomIv()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentIv as BufferSource },
    fileKey,
    await file.arrayBuffer(),
  )

  const nameIv = randomIv()
  const encryptedName = pack(
    nameIv,
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nameIv as BufferSource }, fileKey, encoder.encode(file.name)),
  )

  const wrapIv = randomIv()
  const encryptedFileKey = pack(
    wrapIv,
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv as BufferSource }, vaultKey, rawFileKey as BufferSource),
  )

  return {
    blob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    envelope: { encryptedName, encryptedFileKey, iv: toBase64(contentIv) },
    // The GCM tag makes the ciphertext 16 bytes longer than the plaintext.
    sizeBytes: ciphertext.byteLength,
  }
}

/** Recovers a filename without touching the contents — what the list needs. */
export async function decryptName(vaultKey: CryptoKey, envelope: SecretEnvelope): Promise<string> {
  const fileKey = await unwrapFileKey(vaultKey, envelope.encryptedFileKey)
  const { iv, ciphertext } = unpack(envelope.encryptedName)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    fileKey,
    ciphertext as BufferSource,
  )
  return decoder.decode(plain)
}

/** Decrypts downloaded ciphertext back into a saveable blob. */
export async function decryptFile(
  vaultKey: CryptoKey,
  envelope: SecretEnvelope,
  ciphertext: ArrayBuffer,
): Promise<Blob> {
  const fileKey = await unwrapFileKey(vaultKey, envelope.encryptedFileKey)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    fileKey,
    ciphertext,
  )
  return new Blob([plain], { type: 'application/octet-stream' })
}
