import type { ConnectedAccount, Quota } from '@prisma/client'
import { prisma } from './prisma'
import { bayHasDedicatedCredentials, env } from './env'

/**
 * The array is presented as a chassis of drive bays.
 *
 * A bay is one of three things:
 *   online    a Google account is connected and contributing capacity
 *   empty     ready to accept a drive right now
 *   locked    exists in the chassis but not yet reachable
 *
 * Bays unlock in order: you fill bay 1, which reveals bay 2, and so on. That
 * keeps the first-run screen down to a single decision instead of nine
 * identical empty slots, and it makes the capacity grow visibly as you add
 * drives — which is the point of the product.
 */

export type BayState = 'online' | 'degraded' | 'empty' | 'locked'

export type Bay = {
  index: number
  state: BayState
  /** Set when state is online or degraded. */
  accountId: string | null
  email: string | null
  totalBytes: string | null
  usedBytes: string | null
  lastSyncedAt: string | null
  lastError: string | null
  /** True when this bay has its own OAuth client rather than sharing bay 1's. */
  dedicatedCredentials: boolean
  /** Why a locked bay is locked, phrased as the next action. */
  lockedReason: string | null
}

export async function readBays(userId: string): Promise<Bay[]> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId },
    include: { quota: true },
    orderBy: { bayIndex: 'asc' },
  })

  type Populated = ConnectedAccount & { quota: Quota | null }
  const byIndex = new Map<number, Populated>(
    (accounts as Populated[]).map((a) => [a.bayIndex, a]),
  )
  const filledCount = accounts.length

  const bays: Bay[] = []
  for (let index = 1; index <= env.MAX_DRIVE_BAYS; index++) {
    const account = byIndex.get(index)

    if (account) {
      const healthy = account.status === 'connected' && !account.lastError
      bays.push({
        index,
        state: healthy ? 'online' : 'degraded',
        accountId: account.id,
        email: account.email,
        totalBytes: account.quota?.totalBytes?.toString() ?? null,
        usedBytes: account.quota?.usedBytes?.toString() ?? '0',
        lastSyncedAt: account.quota?.lastSyncedAt?.toISOString() ?? null,
        lastError: account.lastError,
        dedicatedCredentials: bayHasDedicatedCredentials(index),
        lockedReason: null,
      })
      continue
    }

    // The next empty bay after the last filled one is open; the rest wait.
    const isNextOpen = index === filledCount + 1

    bays.push({
      index,
      state: isNextOpen ? 'empty' : 'locked',
      accountId: null,
      email: null,
      totalBytes: null,
      usedBytes: null,
      lastSyncedAt: null,
      lastError: null,
      dedicatedCredentials: bayHasDedicatedCredentials(index),
      lockedReason: isNextOpen ? null : `Fill bay ${filledCount + 1} first`,
    })
  }

  return bays
}

/** The lowest bay number not currently occupied. */
export async function nextFreeBay(userId: string): Promise<number> {
  const taken = await prisma.connectedAccount.findMany({
    where: { userId },
    select: { bayIndex: true },
  })
  const used = new Set(taken.map((t) => t.bayIndex))

  for (let index = 1; index <= env.MAX_DRIVE_BAYS; index++) {
    if (!used.has(index)) return index
  }
  throw new Error(`All ${env.MAX_DRIVE_BAYS} bays are full. Raise MAX_DRIVE_BAYS to add more.`)
}
