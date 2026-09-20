'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/client/api'
import { clearCache } from '@/lib/client/cache'
import { NAV_LINKS, isActiveLink } from './nav-links'
import { Wordmark } from './Wordmark'

/** The desktop rail. Phones get `MobileNav` instead. */
export function Sidebar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    // Nothing of this session survives into the next one.
    clearCache()
    router.push('/login')
    router.refresh()
  }

  const view = search.get('view')

  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-line bg-panel/40 px-3 py-6 sm:flex">
      <Link href="/" className="mb-8 px-2">
        <Wordmark />
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors',
              isActiveLink(href, pathname, view)
                ? 'bg-lift text-ink'
                : 'text-dim hover:bg-lift/60 hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-line pt-3">
        <div className="px-2.5 pb-2">
          <p className="truncate text-sm">{user.name}</p>
          <p className="truncate text-xs text-faint">{user.email}</p>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-dim transition-colors hover:bg-lift/60 hover:text-ink"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
