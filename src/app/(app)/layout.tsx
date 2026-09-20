import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/server/session'
import { Sidebar } from '@/components/Sidebar'
import { MobileNav } from '@/components/MobileNav'
import { UploadDock } from '@/components/UploadDock'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A render cannot set cookies, so it must not rotate the session. The next
  // API call the page makes does that.
  const user = await getCurrentUser({ rotate: false })
  if (!user) redirect('/login')

  return (
    // Column on phones so the nav bar sits above the page; row from `sm` up,
    // where the rail returns to the side.
    <div className="flex min-h-dvh flex-col sm:flex-row">
      {/* Both read the `view` query param, so both need a boundary. */}
      <Suspense fallback={null}>
        <MobileNav user={user} />
      </Suspense>
      <Suspense fallback={<div className="hidden w-52 shrink-0 border-r border-line sm:block" />}>
        <Sidebar user={user} />
      </Suspense>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="safe-bottom mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
      <UploadDock />
    </div>
  )
}
