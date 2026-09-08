import type { ConnectedAccount, Quota } from '@prisma/client'
import { prisma } from '../prisma'
import { syncQuota } from '../providers/google'

/**
 * The routing engine.
 *
 * Everything else in this app is CRUD around one question: given a file of N
 * bytes, which of the connected accounts should receive it? The answer has to
 * respect live quota, honour folder pinning, and never hand the same free
 * space to two files in the same batch.
 */

export const ROUTING_MODES = ['most_available', 'round_robin', 'priority', 'fill_first'] as const
export type RoutingMode = (typeof ROUTING_MODES)[number]

export const ROUTING_MODE_LABELS: Record<RoutingMode, { name: string; description: string }> = {
  most_available: {
    name: 'Most free space',
    description: 'Sends each file to whichever account has the most room left. Keeps every account filling evenly.',
  },
  round_robin: {
    name: 'Round robin',
    description: 'Cycles through accounts in order, one file each. Spreads files widely rather than evenly by size.',
  },
  priority: {
    name: 'Priority order',
    description: 'Always uses the first account in your list that has room. Drag to reorder them.',
  },
  fill_first: {
    name: 'Fill one at a time',
    description: 'Packs each account to capacity before moving to the next. Keeps related files together.',
  },
}

/** Quota readings older than this are refreshed before a routing decision. */
const QUOTA_STALE_MS = 5 * 60_000

export type Candidate = {
  account: ConnectedAccount & { quota: Quota | null }
  /** null means unlimited. Already net of in-flight reservations. */
  availableBytes: bigint | null
}

export class NoSpaceError extends Error {
  constructor(public sizeBytes: bigint) {
    super('No connected account has enough free space for this file.')
  }
}

/**
 * A batch-scoped ledger of bytes promised but not yet written.
 *
 * Without this, uploading five 3 GB files at once when one account has 4 GB
 * free routes all five to that account: each one is checked against the same
 * stale reading and each one "fits".
 */
export class Reservations {
  private held = new Map<string, bigint>()

  get(accountId: string): bigint {
    return this.held.get(accountId) ?? 0n
  }

  hold(accountId: string, bytes: bigint) {
    this.held.set(accountId, this.get(accountId) + bytes)
  }

  release(accountId: string, bytes: bigint) {
    const next = this.get(accountId) - bytes
    this.held.set(accountId, next > 0n ? next : 0n)
  }
}

async function loadAccounts(userId: string) {
  return prisma.connectedAccount.findMany({
    where: { userId, status: 'connected' },
    include: { quota: true },
    orderBy: { createdAt: 'asc' },
  })
}

/** Refreshes any quota reading older than QUOTA_STALE_MS, in parallel. */
async function refreshStaleQuotas(accounts: Array<ConnectedAccount & { quota: Quota | null }>) {
  const cutoff = Date.now() - QUOTA_STALE_MS
  const stale = accounts.filter((a) => !a.quota?.lastSyncedAt || a.quota.lastSyncedAt.getTime() < cutoff)
  if (stale.length === 0) return false
  await Promise.allSettled(stale.map((a) => syncQuota(a.id)))
  return true
}

export async function getRoutingPolicy(userId: string) {
  return prisma.routingPolicy.upsert({
    where: { userId },
    create: { userId, mode: 'most_available', priorityOrder: [] },
    update: {},
  })
}

/**
 * Accounts that could take a file of this size, cheapest signal first.
 *
 * `headroomPercent` leaves a slice of each account untouched. Drive's reported
 * usage lags actual writes, so routing to the last byte reliably produces
 * failed uploads at 99% full.
 */
function eligible(
  accounts: Array<ConnectedAccount & { quota: Quota | null }>,
  sizeBytes: bigint,
  reservations: Reservations,
  headroomPercent: number,
): Candidate[] {
  return accounts
    .map((account) => {
      const total = account.quota?.totalBytes ?? null
      if (total === null) return { account, availableBytes: null }

      const reserve = (total * BigInt(Math.max(0, Math.min(50, headroomPercent)))) / 100n
      const raw = (account.quota?.availableBytes ?? 0n) - reserve - reservations.get(account.id)
      return { account, availableBytes: raw > 0n ? raw : 0n }
    })
    .filter((c) => c.availableBytes === null || c.availableBytes >= sizeBytes)
}

function byPriorityOrder(candidates: Candidate[], order: string[]): Candidate[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...candidates].sort((a, b) => {
    const ra = rank.get(a.account.id)
    const rb = rank.get(b.account.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.account.createdAt.getTime() - b.account.createdAt.getTime()
  })
}

function compareFreeSpaceDesc(a: Candidate, b: Candidate) {
  // Unlimited accounts (S3-style) sort first — they can always absorb the file.
  if (a.availableBytes === null && b.availableBytes === null) return 0
  if (a.availableBytes === null) return -1
  if (b.availableBytes === null) return 1
  return a.availableBytes > b.availableBytes ? -1 : a.availableBytes < b.availableBytes ? 1 : 0
}

export type RoutingDecision = {
  account: ConnectedAccount & { quota: Quota | null }
  reason: string
  candidates: Candidate[]
}

/**
 * Picks the destination account for one file.
 *
 * @param pinnedAccountId Set when the target folder already lives on a specific
 *   account. A folder's contents must never scatter, so this overrides policy
 *   entirely — if the pinned account is full, the upload fails rather than
 *   silently landing somewhere else.
 */
export async function selectAccount(
  userId: string,
  sizeBytes: bigint,
  options: {
    pinnedAccountId?: string | null
    reservations?: Reservations
    /**
     * Skip the Google round trip and route on the stored reading.
     *
     * Only for previews. A real upload must not be routed on a stale number —
     * that is how a file lands on an account that filled up ten minutes ago.
     */
    allowStaleQuota?: boolean
  } = {},
): Promise<RoutingDecision> {
  const reservations = options.reservations ?? new Reservations()

  let accounts = await loadAccounts(userId)
  if (accounts.length === 0) throw new Error('Connect a Google account before uploading.')

  if (!options.allowStaleQuota && (await refreshStaleQuotas(accounts))) accounts = await loadAccounts(userId)

  const policy = await getRoutingPolicy(userId)
  const candidates = eligible(accounts, sizeBytes, reservations, policy.headroomPercent)

  if (options.pinnedAccountId) {
    const pinned = candidates.find((c) => c.account.id === options.pinnedAccountId)
    if (!pinned) throw new NoSpaceError(sizeBytes)
    return { account: pinned.account, reason: "Pinned to this folder's account", candidates }
  }

  if (candidates.length === 0) throw new NoSpaceError(sizeBytes)

  const mode = (ROUTING_MODES as readonly string[]).includes(policy.mode)
    ? (policy.mode as RoutingMode)
    : 'most_available'

  switch (mode) {
    case 'priority': {
      const picked = byPriorityOrder(candidates, policy.priorityOrder)[0]
      return { account: picked.account, reason: 'First account in your priority list with room', candidates }
    }

    case 'round_robin': {
      const ordered = byPriorityOrder(candidates, policy.priorityOrder)
      const picked = ordered[policy.roundRobinCursor % ordered.length]
      await prisma.routingPolicy.update({
        where: { userId },
        data: { roundRobinCursor: (policy.roundRobinCursor + 1) % 1_000_000 },
      })
      return { account: picked.account, reason: 'Next in the rotation', candidates }
    }

    case 'fill_first': {
      // Least free space that still fits — packs accounts tight before moving on.
      const picked = [...candidates].sort(compareFreeSpaceDesc).reverse()[0]
      return { account: picked.account, reason: 'Topping up the fullest account that still fits', candidates }
    }

    case 'most_available':
    default: {
      const picked = [...candidates].sort(compareFreeSpaceDesc)[0]
      return { account: picked.account, reason: 'Most free space right now', candidates }
    }
  }
}

/**
 * Answers "where would my next upload go?" without committing to anything.
 * Drives the routing preview on the dashboard.
 *
 * Reads the stored quota rather than refreshing from Google. Every other
 * number on that dashboard already comes from the same stored reading, so
 * refreshing for this one line made the whole panel wait on five Drive round
 * trips — seconds — to answer a question that is explicitly a preview. The
 * upload path still refreshes before it commits to anything.
 */
export async function previewRouting(userId: string, sizeBytes = 0n) {
  try {
    const decision = await selectAccount(userId, sizeBytes, { allowStaleQuota: true })
    return {
      accountId: decision.account.id,
      email: decision.account.email,
      reason: decision.reason,
      eligibleCount: decision.candidates.length,
    }
  } catch {
    return null
  }
}
