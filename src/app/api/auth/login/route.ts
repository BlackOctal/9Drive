import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { verifyPassword } from '@/lib/server/crypto'
import { startSession } from '@/lib/server/session'
import { apiHandler, fail } from '@/lib/server/api'

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

export const POST = apiHandler(async (req: NextRequest) => {
  const body = schema.parse(await req.json())
  const user = await prisma.user.findUnique({ where: { email: body.email } })

  // Same message and roughly the same work either way, so the response does
  // not reveal whether an address is registered.
  const ok = user ? await verifyPassword(user.passwordHash, body.password) : false
  if (!user || !ok) return fail(401, 'That email and password do not match.', 'BAD_CREDENTIALS')
  if (user.status !== 'active') return fail(403, 'This account is disabled.', 'DISABLED')

  await startSession(user.id, { userAgent: req.headers.get('user-agent') ?? undefined })
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } })
})
