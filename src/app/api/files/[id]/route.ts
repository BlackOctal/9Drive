import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { deleteRemoteFile, renameRemoteFile, syncQuota, trashRemoteFile } from '@/lib/server/providers/google'
import { serializeBytes } from '@/lib/bytes'
import { apiHandler, fail, log } from '@/lib/server/api'

type Ctx = { params: Promise<{ id: string }> }

async function ownedFile(userId: string, id: string) {
  return prisma.file.findFirst({ where: { id, userId }, include: { account: true } })
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(512).optional(),
  starred: z.boolean().optional(),
  folderId: z.string().nullable().optional(),
  restore: z.boolean().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const userId = await requireUserId()
  const { id } = await params
  const body = patchSchema.parse(await req.json())

  const file = await ownedFile(userId, id)
  if (!file) return fail(404, 'That file no longer exists.', 'NOT_FOUND')

  // Renames propagate to Drive so the two views never drift apart.
  if (body.name && body.name !== file.name) {
    await renameRemoteFile(file.account, file.providerFileId, body.name)
  }

  const updated = await prisma.file.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.starred !== undefined ? { starred: body.starred } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      ...(body.restore ? { status: 'active', deletedAt: null } : {}),
    },
  })

  return NextResponse.json({ file: { ...updated, sizeBytes: serializeBytes(updated.sizeBytes) } })
})

/**
 * Soft delete by default (moves the Drive file to its own trash, recoverable).
 * `?permanent=1` deletes for real and frees the quota.
 */
export const DELETE = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const userId = await requireUserId()
  const { id } = await params
  const permanent = req.nextUrl.searchParams.get('permanent') === '1'

  const file = await ownedFile(userId, id)
  if (!file) return fail(404, 'That file no longer exists.', 'NOT_FOUND')

  if (permanent) {
    await deleteRemoteFile(file.account, file.providerFileId).catch(() => undefined)
    await prisma.file.delete({ where: { id } })
  } else {
    await trashRemoteFile(file.account, file.providerFileId).catch(() => undefined)
    await prisma.file.update({ where: { id }, data: { status: 'trashed', deletedAt: new Date() } })
  }

  await log(userId, permanent ? 'file.delete' : 'file.trash', 'file', id, { name: file.name })
  void syncQuota(file.accountId)
  return NextResponse.json({ ok: true })
})
