import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/server/session'
import { apiHandler } from '@/lib/server/api'


export const GET = apiHandler(async () => {
  const user = await getCurrentUser()
  return NextResponse.json({ user })
})
