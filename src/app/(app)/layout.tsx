import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/server/session'
import { Sidebar } from '@/components/Sidebar'
import { UploadDock } from '@/components/UploadDock'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A render cannot set cookies, so it must not rotate the session. The next
  // API call the page makes does that.
  const user = await getCurrentUser({ rotate: false })
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-dvh">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>
      </div>
      <UploadDock />
    </div>
  )
}
