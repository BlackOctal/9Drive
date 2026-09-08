import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { serializeBytes } from '@/lib/bytes'
import { FOLDER_MIME, getBreadcrumbs, listFolder } from '@/lib/server/providers/google'
import { apiHandler, fail } from '@/lib/server/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Browses one connected drive, live.
 *
 * The listing comes from Google, not from the File table — so it includes
 * everything actually in the account, whether or not 9Drive put it there.
 * The database is consulted for exactly one thing: marking which entries the
 * pool already tracks, so the two sets stay distinguishable in the UI.
 */
export const GET = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) => {
  const userId = await requireUserId()
  const { accountId } = await params

  // Scoped by userId: without this the route lists any user's drive.
  const account = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId } })
  if (!account) return fail(404, 'That drive is not connected to this account.', 'NOT_FOUND')

  const folderId = req.nextUrl.searchParams.get('folderId') || 'root'
  const pageToken = req.nextUrl.searchParams.get('pageToken') || undefined

  const [listing, breadcrumbs] = await Promise.all([
    listFolder(account, folderId, pageToken),
    getBreadcrumbs(account, folderId),
  ])

  const managed = new Set(
    (
      await prisma.file.findMany({
        where: { accountId: account.id, providerFileId: { in: listing.files.map((f) => f.id) } },
        select: { providerFileId: true },
      })
    ).map((f) => f.providerFileId),
  )

  const quota = await prisma.quota.findUnique({ where: { accountId: account.id } })

  return NextResponse.json({
    drive: {
      id: account.id,
      bayIndex: account.bayIndex,
      email: account.email,
      status: account.status,
      quota: {
        totalBytes: serializeBytes(quota?.totalBytes ?? null),
        usedBytes: serializeBytes(quota?.usedBytes ?? 0n),
        availableBytes: serializeBytes(quota?.availableBytes ?? null),
      },
    },
    folderId,
    breadcrumbs,
    entries: listing.files.map((f) => ({
      ...f,
      isFolder: f.mimeType === FOLDER_MIME,
      managed: managed.has(f.id),
    })),
    nextPageToken: listing.nextPageToken,
  })
})
