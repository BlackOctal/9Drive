import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { getFileMetadata } from '@/lib/server/providers/google'
import { streamDriveFile } from '@/lib/server/download'
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
 * Streams any file in a connected drive by its Drive id, whether or not
 * 9Drive tracks it. Same Range forwarding and export handling as the pooled
 * download route; the only difference is the lookup.
 *
 * The account-ownership check is what stops this being an open proxy to any
 * Drive file id in the world. It is not optional.
 */
export const GET = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ accountId: string; fileId: string }> }) => {
    const userId = await requireUserId()
    const { accountId, fileId } = await params

    const account = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId } })
    if (!account) return fail(404, 'That drive is not connected to this account.', 'NOT_FOUND')

    // Drive is the source of truth for name and type here — there may be no
    // File row at all.
    let meta: { name: string; mimeType: string }
    try {
      meta = await getFileMetadata(account, fileId)
    } catch {
      return fail(404, 'That file is not in this drive.', 'NOT_FOUND')
    }

    return streamDriveFile(
      account,
      fileId,
      meta,
      { download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') },
    )
  },
)
