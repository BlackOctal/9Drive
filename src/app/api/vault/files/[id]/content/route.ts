import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { openVaultFileStream } from '@/lib/server/providers/google'
import { apiHandler, fail } from '@/lib/server/api'

export const runtime = 'nodejs'
/*
  Vercel rejects a deployment whose function exceeds the plan's limit, and
  Hobby caps at 60 seconds. 300 needs Pro. Raise this back to 300 on Pro if
  you serve large files over slow connections — at 60 a multi-gigabyte
  download can be cut off mid-stream.
*/
export const maxDuration = 60

/**
 * Streams a vault file's ciphertext.
 *
 * No Range forwarding and no Content-Disposition: this is not a file the
 * browser can do anything with. AES-GCM authenticates the whole message, so
 * decryption needs every byte — which is also why the vault has no preview and
 * no video player. The client fetches this, decrypts it, and saves the result.
 */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId()
  const { id } = await params

  const secret = await prisma.secretFile.findFirst({ where: { id, userId }, include: { account: true } })
  if (!secret) return fail(404, 'That file is not in your vault.', 'NOT_FOUND')

  const upstream = await openVaultFileStream(secret.account, secret.providerFileId)
  if (!upstream.ok || !upstream.body) {
    return fail(
      upstream.status === 404 ? 404 : 502,
      upstream.status === 404
        ? 'This file is no longer in the drive’s app data folder. Encrypted contents cannot be recovered.'
        : 'Google could not serve that file.',
      'UPSTREAM',
    )
  }

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  const length = upstream.headers.get('content-length')
  if (length) headers.set('content-length', length)

  return new Response(upstream.body, { status: 200, headers })
})
