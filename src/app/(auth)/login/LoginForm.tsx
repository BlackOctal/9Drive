'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/client/api'

export function LoginForm({ initialError, allowRegister }: { initialError?: string; allowRegister: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>(allowRegister ? 'register' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'register' ? { name, email, password } : { email, password }),
      })
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-sm border border-line bg-panel px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-line-bright'

  return (
    <div className="space-y-5">
      <a
        href="/api/auth/google/url?flow=login&redirect=1"
        className="flex w-full items-center justify-center gap-2.5 rounded-sm border border-line bg-panel px-4 py-3 text-sm font-medium transition-colors hover:border-line-bright hover:bg-lift"
      >
        <GoogleMark />
        Continue with Google
      </a>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="eyebrow">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === 'register' && (
          <input
            className={field}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        )}
        <input
          className={field}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <input
          className={field}
          type="password"
          placeholder={mode === 'register' ? 'At least 10 characters' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />

        {error && (
          <p className="rounded-sm border border-alarm/30 bg-alarm/10 px-3 py-2 text-xs text-alarm" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-signal px-4 py-2.5 text-sm font-semibold text-void transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {allowRegister && (
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
          }}
          className="w-full text-center text-xs text-dim transition-colors hover:text-ink"
        >
          {mode === 'login' ? 'No account yet? Create one' : 'Already set up? Sign in'}
        </button>
      )}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.8 18.9 23 15.9 23 12.3z" />
      <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z" />
      <path fill="#FBBC05" d="M5.6 14.3a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.7l3.8-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.2-3.2C17.7 1.5 15.1.4 12 .4 7.6.4 3.7 3 1.8 6.7l3.8 3C6.5 6.9 9 4.8 12 4.8z" />
    </svg>
  )
}
