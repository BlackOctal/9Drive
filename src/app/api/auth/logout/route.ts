import { NextResponse } from 'next/server'
import { endSession } from '@/lib/server/session'
import { apiHandler } from '@/lib/server/api'

export const POST = apiHandler(async () => {
  await endSession()
  return NextResponse.json({ ok: true })
})
