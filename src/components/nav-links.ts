import { Files, Gauge, HardDrive, Lock, Route, Star, Trash2, type LucideIcon } from 'lucide-react'

export type NavLink = { href: string; label: string; icon: LucideIcon }

/** One list, rendered by the desktop rail and the phone drawer alike. */
export const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Array', icon: Gauge },
  { href: '/files', label: 'Files', icon: Files },
  { href: '/files?view=starred', label: 'Starred', icon: Star },
  { href: '/accounts', label: 'Drives', icon: HardDrive },
  { href: '/routing', label: 'Routing', icon: Route },
  { href: '/vault', label: 'Vault', icon: Lock },
  { href: '/files?view=trash', label: 'Trash', icon: Trash2 },
]

/**
 * Whether a link is the one currently open.
 *
 * Three links share the `/files` path and differ only by `view`, so matching
 * on pathname alone lit Files, Starred and Trash all at once. The view has to
 * be part of the comparison, with `all` and absent treated as the same thing.
 */
export function isActiveLink(href: string, pathname: string, view: string | null): boolean {
  const [base, query] = href.split('?')

  // A drive browser is a page *under* Drives; keep that entry lit while in one.
  if (base === '/accounts' && pathname.startsWith('/drives')) return true
  if (base !== pathname) return false

  const wanted = query ? new URLSearchParams(query).get('view') : null
  return wanted === (view === 'all' ? null : view)
}
