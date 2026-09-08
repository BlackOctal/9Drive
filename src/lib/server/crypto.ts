import crypto from 'node:crypto'
import { env } from './env'

/**
 * Envelope format: v1:<iv>:<tag>:<ciphertext>, all base64.
 * The version prefix exists so keys can be rotated later without guessing
 * which key encrypted a given row.
 */
const VERSION = 'v1'
const key = crypto.createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY).digest()

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

export function decrypt(envelope: string): string {
  const parts = envelope.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised encryption envelope')
  const [, ivRaw, tagRaw, dataRaw] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8')
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Tokens are looked up by hash so a database dump is not a set of live credentials. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16)
    crypto.scrypt(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err)
      resolve(`scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`)
    })
  })
}

export function verifyPassword(stored: string, password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [scheme, N, r, p, saltRaw, hashRaw] = stored.split('$')
    if (scheme !== 'scrypt') return resolve(false)
    const expected = Buffer.from(hashRaw, 'base64')
    crypto.scrypt(
      password,
      Buffer.from(saltRaw, 'base64'),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p) },
      (err, derived) => {
        if (err) return resolve(false)
        resolve(crypto.timingSafeEqual(expected, derived))
      },
    )
  })
}
