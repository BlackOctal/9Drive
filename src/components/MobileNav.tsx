'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LogOut, Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/client/api'
import { clearCache } from '@/lib/client/cache'
import { NAV_LINKS, isActiveLink } from './nav-links'
import { Wordmark } from './Wordmark'

/**
 * Navigation for phones.
 *
 * The desktop rail is `hidden sm:flex`, which left a phone with no way to
 * reach anything but the page it landed on. Seven destinations is too many for
 * a bottom tab bar, so this is a bar plus a drawer.
 *
 * Both are padded by `env(safe-area-inset-*)`: added to the Home Screen the
 * app runs fullscreen, where the status bar sits over the top of the page and
 * the home indicator over the bottom.
 */
export function MobileNav({ user }: { user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()

  // Any navigation closes the drawer, including the browser's back gesture.
  useEffect(() => {
    setOpen(false)
  }, [pathname, search])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    // Stop the page behind the drawer scrolling with the drawer.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearCache()
    router.push('/login')
    router.refresh()
  }

  const view = search.get('view')

  return (
    <>
      <header className="safe-top sticky top-0 z-40 flex items-center justify-between border-b border-line bg-panel/90 px-4 backdrop-blur-sm sm:hidden">
        <Link href="/" className="py-3">
          <Wordmark />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-mr-2 rounded-sm p-2.5 text-dim transition-colors hover:text-ink"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] sm:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-void/70 backdrop-blur-[2px]"
          />

          <nav className="safe-top safe-bottom absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel px-3 shadow-2xl">
            <div className="flex items-center justify-between py-3 pl-2">
              <Wordmark />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-sm p-2 text-dim transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2">
              {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                const active = isActiveLink(href, pathname, view)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      // Generous target: this is a thumb, not a cursor.
                      'flex items-center gap-3 rounded-sm px-3 py-3 text-sm transition-colors',
                      active ? 'bg-lift text-ink' : 'text-dim active:bg-lift/60',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {label}
                  </Link>
                )
              })}
            </div>

            <div className="border-t border-line py-3">
              <div className="px-3 pb-2">
                <p className="truncate text-sm">{user.name}</p>
                <p className="truncate text-xs text-faint">{user.email}</p>
              </div>
              <button
                onClick={signOut}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-3 text-sm text-dim transition-colors active:bg-lift/60"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
