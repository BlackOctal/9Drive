/**
 * Shared vault constants.
 *
 * Kept out of the client crypto module so a route handler can import the cap
 * without dragging a `'use client'` file — and the Web Crypto code inside it —
 * into the server bundle.
 */

/**
 * Encrypting in browser memory holds the whole file at once, so this is the
 * point past which the tab dies rather than a policy choice. Streaming
 * encryption would lift it; that is deliberately out of scope.
 */
export const MAX_VAULT_FILE_BYTES = 100 * 1024 * 1024
