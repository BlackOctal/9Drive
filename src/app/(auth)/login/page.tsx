import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/server/session'
import { prisma } from '@/lib/server/prisma'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await getCurrentUser({ rotate: false })
  if (user) redirect('/')

  const { error } = await searchParams
  // Offer "create account" only while nobody has claimed this instance.
  const hasUsers = (await prisma.user.count()) > 0

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <div className="flex items-end gap-1" aria-hidden>
            {[38, 62, 24, 80, 46].map((h, i) => (
              <span
                key={i}
                className={i === 3 ? 'w-2 rounded-[1px] bg-signal' : 'w-2 rounded-[1px] bg-line-bright'}
                style={{ height: `${h * 0.4}px` }}
              />
            ))}
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">9Drive</h1>
          <p className="mt-1.5 text-sm text-dim">
            Several Google accounts, one volume. Files route to whichever has room.
          </p>
        </div>

        <LoginForm initialError={error} allowRegister={!hasUsers} />
      </div>
    </main>
  )
}
