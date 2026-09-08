'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Files, Gauge, HardDrive, Lock, LogOut, Route, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/client/api'
import { clearCache } from '@/lib/client/cache'

const LINKS = [
  { href: '/', label: 'Array', icon: Gauge },
  { href: '/files', label: 'Files', icon: Files },
  { href: '/files?view=starred', label: 'Starred', icon: Star },
  { href: '/accounts', label: 'Drives', icon: HardDrive },
  { href: '/routing', label: 'Routing', icon: Route },
  { href: '/vault', label: 'Vault', icon: Lock },
  { href: '/files?view=trash', label: 'Trash', icon: Trash2 },
]

export function Sidebar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    // Nothing of this session survives into the next one.
    clearCache()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-line bg-panel/40 px-3 py-6 sm:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="flex items-end gap-[3px]" aria-hidden>
          {[10, 16, 7, 20].map((h, i) => (
            <span
              key={i}
              className={cn('w-[3px] rounded-[1px]', i === 3 ? 'bg-signal' : 'bg-line-bright')}
              style={{ height: h }}
            />
          ))}
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">9Drive</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const base = href.split('?')[0]
          const active = href === '/' ? pathname === '/' : pathname === base
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors',
                active ? 'bg-lift text-ink' : 'text-dim hover:bg-lift/60 hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </Link>
          )
        })}
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
