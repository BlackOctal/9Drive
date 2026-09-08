import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { apiHandler, fail, log } from '@/lib/server/api'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Disconnects an account. The remote files are left untouched on Drive — this
 * removes our pointers, not the user's data. Refusing while files reference it
 * would strand them, so the file rows are marked orphaned instead.
 */
export const DELETE = apiHandler(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId()
  const { id } = await params

  const account = await prisma.connectedAccount.findFirst({ where: { id, userId } })
  if (!account) return fail(404, 'That account is not connected.', 'NOT_FOUND')

  await prisma.$transaction([
    prisma.file.updateMany({
      where: { accountId: id, status: 'active' },
      data: { status: 'orphaned', deletedAt: new Date() },
    }),
    prisma.connectedAccount.delete({ where: { id } }),
  ])

  await log(userId, 'account.disconnect', 'account', id, { email: account.email })
  return NextResponse.json({ ok: true })
})
