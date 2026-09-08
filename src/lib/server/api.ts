import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { Unauthorized } from './session'
import { NoSpaceError } from './routing/select-account'
import { prisma } from './prisma'

export type ApiError = { error: string; code?: string; detail?: unknown }

export function fail(status: number, error: string, code?: string, detail?: unknown) {
  return NextResponse.json<ApiError>({ error, code, detail }, { status })
}

/**
 * Wraps a route handler so failures become predictable JSON instead of an
 * opaque 500. Errors the UI needs to distinguish get their own code.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof Unauthorized) return fail(401, 'Sign in to continue.', 'UNAUTHORIZED')

      if (error instanceof ZodError) {
        const first = error.issues[0]
        return fail(400, first ? `${first.path.join('.')}: ${first.message}` : 'That request was not valid.', 'INVALID', error.issues)
      }

      if (error instanceof NoSpaceError) {
        return fail(507, 'No connected account has enough free space for this file.', 'NO_SPACE')
      }

      const message = error instanceof Error ? error.message : 'Something went wrong.'
      console.error('[api]', message, error)
      return fail(500, message, 'INTERNAL')
    }
  }
}

export function log(userId: string | null, action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  return prisma.auditLog.create({ data: { userId, action, entityType, entityId, metadata: metadata as never } }).catch(() => undefined)
}
