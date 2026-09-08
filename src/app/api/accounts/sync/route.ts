import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { syncQuota } from '@/lib/server/providers/google'
import { apiHandler } from '@/lib/server/api'

/** Forces a quota re-read on every connected account. */
export const POST = apiHandler(async () => {
  const userId = await requireUserId()
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: { in: ['connected', 'reauth_required'] } },
    select: { id: true },
  })

  const results = await Promise.allSettled(accounts.map((a) => syncQuota(a.id)))
  const refreshed = results.filter((r) => r.status === 'fulfilled' && r.value !== null).length

  return NextResponse.json({ refreshed, total: accounts.length })
})
