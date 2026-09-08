import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

const query = z.object({
  folderId: z.string().nullish(),
  search: z.string().trim().max(200).nullish(),
  view: z.enum(['all', 'recent', 'starred', 'trash']).default('all'),
  accountId: z.string().nullish(),
  take: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().nullish(),
})

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const q = query.parse(Object.fromEntries(req.nextUrl.searchParams))

  const where = {
    userId,
    status: q.view === 'trash' ? 'trashed' : 'active',
    ...(q.view === 'starred' ? { starred: true } : {}),
    ...(q.accountId ? { accountId: q.accountId } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
    // A search or a flat view spans every folder; browsing scopes to one.
    ...(q.view === 'all' && !q.search ? { folderId: q.folderId ?? null } : {}),
  }

  const files = await prisma.file.findMany({
    where,
    include: { account: { select: { id: true, email: true, bayIndex: true } } },
    orderBy: q.view === 'recent' ? { updatedAt: 'desc' } : { createdAt: 'desc' },
    take: q.take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  })

  const hasMore = files.length > q.take
  const page = hasMore ? files.slice(0, q.take) : files

  return NextResponse.json({
    files: page.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: serializeBytes(f.sizeBytes),
      starred: f.starred,
      folderId: f.folderId,
      account: f.account,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  })
})
