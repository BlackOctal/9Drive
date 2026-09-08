import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { requireUserId } from '@/lib/server/session'
import { ROUTING_MODES, getRoutingPolicy, previewRouting } from '@/lib/server/routing/select-account'
import { apiHandler, log } from '@/lib/server/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const userId = await requireUserId()
  const [policy, nextTarget] = await Promise.all([getRoutingPolicy(userId), previewRouting(userId)])
  return NextResponse.json({ policy, nextTarget })
})

const schema = z.object({
  mode: z.enum(ROUTING_MODES),
  priorityOrder: z.array(z.string()).max(64).optional(),
  headroomPercent: z.number().int().min(0).max(50).optional(),
})

export const PATCH = apiHandler(async (req: NextRequest) => {
  const userId = await requireUserId()
  const body = schema.parse(await req.json())

  // Drop any ids that are not this user's live accounts, so a stale UI cannot
  // pin routing to something that no longer exists.
  let priorityOrder: string[] | undefined
  if (body.priorityOrder) {
    const owned = await prisma.connectedAccount.findMany({
      where: { id: { in: body.priorityOrder }, userId, status: 'connected' },
      select: { id: true },
    })
    const valid = new Set(owned.map((a) => a.id))
    priorityOrder = [...new Set(body.priorityOrder)].filter((id) => valid.has(id))
  }

  const policy = await prisma.routingPolicy.upsert({
    where: { userId },
    create: { userId, mode: body.mode, priorityOrder: priorityOrder ?? [], headroomPercent: body.headroomPercent ?? 2 },
    update: {
      mode: body.mode,
      ...(priorityOrder ? { priorityOrder } : {}),
      ...(body.headroomPercent !== undefined ? { headroomPercent: body.headroomPercent } : {}),
      // A mode change should restart the rotation, not resume mid-cycle.
      ...(body.mode !== 'round_robin' ? { roundRobinCursor: 0 } : {}),
    },
  })

  await log(userId, 'routing.update', 'policy', policy.id, { mode: policy.mode })
  return NextResponse.json({ policy, nextTarget: await previewRouting(userId) })
})
