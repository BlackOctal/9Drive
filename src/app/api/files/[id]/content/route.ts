import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { streamDriveFile } from '@/lib/server/download'
import { apiHandler, fail } from '@/lib/server/api'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Streams a pooled file's bytes back through the app, by its 9Drive id. */
export const GET = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId()
  const { id } = await params

  const file = await prisma.file.findFirst({
    where: { id, userId, status: { in: ['active', 'trashed'] } },
    include: { account: true },
  })
  if (!file) return fail(404, 'That file no longer exists.', 'NOT_FOUND')

  return streamDriveFile(
    file.account,
    file.providerFileId,
    { name: file.name, mimeType: file.mimeType },
    { download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') },
  )
})
