import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { env } from '@/lib/server/env'
import { requireUserId } from '@/lib/server/session'
import { Reservations, selectAccount } from '@/lib/server/routing/select-account'
import { createResumableSession, ensureRootFolder } from '@/lib/server/providers/google'
import { apiHandler, fail } from '@/lib/server/api'

export const runtime = 'nodejs'
export const maxDuration = 30

const fileSchema = z.object({
  name: z.string().trim().min(1).max(512),
  mimeType: z.string().trim().min(1).default('application/octet-stream'),
  sizeBytes: z.string().regex(/^\d+$/, 'sizeBytes must be a digit string'),
  folderId: z.string().nullish(),
})

const schema = z.object({ files: z.array(fileSchema).min(1).max(50) })

/**
 * Phase one of an upload.
 *
 * For each file we pick a destination account, ensure its `9drive` folder
 * exists, and ask Google to open a resumable session. What comes back is a
 * session URI that carries its own authorisation — so we hand it to the
 * browser and the browser PUTs the bytes straight to Google.
 *
 * The server never sees file content. That is what keeps this deployable on
 * serverless, where a request body is capped at a few megabytes and a function
 * cannot sit open for the length of a 4 GB upload.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const { files } = schema.parse(await req.json())

  const connectedCount = await prisma.connectedAccount.count({ where: { userId, status: 'connected' } })
  if (connectedCount === 0) {
    return fail(400, 'Connect a Google account before uploading.', 'NO_ACCOUNTS')
  }

  // One ledger for the whole batch, so ten files cannot each claim the same
  // last gigabyte on the same account.
  const reservations = new Reservations()
  const origin = env.APP_URL

  const results = []
  for (const file of files) {
    const sizeBytes = BigInt(file.sizeBytes)

    try {
      if (sizeBytes <= 0n) throw new Error('That file is empty.')

      // A folder lives on exactly one account. Its contents follow it.
      let pinnedAccountId: string | null = null
      let parentOverride: string | null = null
      if (file.folderId) {
        const folder = await prisma.folder.findFirst({
          where: { id: file.folderId, userId, deletedAt: null },
          select: { accountId: true, providerFolderId: true },
        })
        if (!folder) throw new Error('That folder no longer exists.')
        pinnedAccountId = folder.accountId
        parentOverride = folder.providerFolderId
      }

      const decision = await selectAccount(userId, sizeBytes, { pinnedAccountId, reservations })
      const account = decision.account
      const parentId = parentOverride ?? (await ensureRootFolder(account))

      const uploadUrl = await createResumableSession(
        account,
        { name: file.name, mimeType: file.mimeType, sizeBytes, parentId },
        origin,
      )

      const session = await prisma.uploadSession.create({
        data: {
          userId,
          accountId: account.id,
          folderId: file.folderId ?? null,
          fileName: file.name,
          mimeType: file.mimeType,
          sizeBytes,
          uploadUrl,
          status: 'uploading',
          // Google keeps a resumable session alive for about a week.
          expiresAt: new Date(Date.now() + 6 * 86400_000),
        },
      })

      reservations.hold(account.id, sizeBytes)

      results.push({
        ok: true as const,
        name: file.name,
        sessionId: session.id,
        uploadUrl,
        account: { id: account.id, email: account.email },
        reason: decision.reason,
      })
    } catch (error) {
      results.push({
        ok: false as const,
        name: file.name,
        error: error instanceof Error ? error.message : 'Could not prepare this upload.',
      })
    }
  }

  return NextResponse.json({ results }, { status: 201 })
})
