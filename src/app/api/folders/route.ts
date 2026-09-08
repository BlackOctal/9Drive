import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { createFolder, ensureRootFolder } from '@/lib/server/providers/google'
import { selectAccount } from '@/lib/server/routing/select-account'
import { apiHandler, fail, log } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const parentId = req.nextUrl.searchParams.get('parentId')

  const folders = await prisma.folder.findMany({
    where: { userId, deletedAt: null, ...(parentId !== null ? { parentId: parentId || null } : {}) },
    include: {
      account: { select: { id: true, email: true } },
      _count: { select: { files: { where: { status: 'active' } }, children: true } },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      account: f.account,
      fileCount: f._count.files,
      childCount: f._count.children,
      updatedAt: f.updatedAt.toISOString(),
    })),
  })
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().nullish(),
})

/**
 * Creates a folder and mirrors it on Drive.
 *
 * A new top-level folder is bound to whichever account routing picks; a
 * subfolder inherits its parent's account. That binding is what lets the
 * upload path guarantee a folder's contents stay on one account.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const body = createSchema.parse(await req.json())

  let accountId: string | null = null
  let parentProviderId: string | null = null

  if (body.parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: body.parentId, userId, deletedAt: null },
      include: { account: true },
    })
    if (!parent) return fail(404, 'That parent folder no longer exists.', 'NOT_FOUND')
    accountId = parent.accountId
    parentProviderId = parent.providerFolderId
  }

  let providerFolderId: string | null = null
  if (accountId) {
    const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
    providerFolderId = await createFolder(account, body.name, parentProviderId ?? (await ensureRootFolder(account)))
  } else {
    // Size 0: we only need a healthy account, not one with room for a payload.
    const { account } = await selectAccount(userId, 0n)
    accountId = account.id
    providerFolderId = await createFolder(account, body.name, await ensureRootFolder(account))
  }

  const folder = await prisma.folder.create({
    data: { userId, name: body.name, parentId: body.parentId ?? null, accountId, providerFolderId },
  })

  await log(userId, 'folder.create', 'folder', folder.id, { name: folder.name })
  return NextResponse.json({ folder }, { status: 201 })
})
