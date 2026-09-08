import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/server/prisma'
import { env } from '@/lib/server/env'
import { hashPassword } from '@/lib/server/crypto'
import { startSession } from '@/lib/server/session'
import { apiHandler, fail, log } from '@/lib/server/api'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
})

export const POST = apiHandler(async (req: NextRequest) => {
  const body = schema.parse(await req.json())

  // Single-user mode: one address is allowed to create the account.
  if (env.ALLOWED_EMAIL && env.ALLOWED_EMAIL.toLowerCase() !== body.email) {
    return fail(403, 'Sign-ups are closed on this instance.', 'SIGNUP_CLOSED')
  }

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })
  if (existing) return fail(409, 'That email is already registered.', 'EMAIL_TAKEN')

  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password) },
    select: { id: true, name: true, email: true },
  })

  await startSession(user.id, { userAgent: req.headers.get('user-agent') ?? undefined })
  await log(user.id, 'user.register', 'user', user.id)
  return NextResponse.json({ user }, { status: 201 })
})
