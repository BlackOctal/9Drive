import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const condensed = IBM_Plex_Sans_Condensed({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-condensed' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono-face' })

export const metadata: Metadata = {
  title: '9Drive — one drive from many',
  description: 'Pool several Google Drive accounts into a single storage volume.',
  // Added to the iOS Home Screen, this runs without Safari's chrome.
  appleWebApp: { capable: true, title: '9Drive', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  themeColor: '#0e1116',
  // Lets the page reach under the notch and home indicator, which is what
  // makes env(safe-area-inset-*) report anything to pad with.
  viewportFit: 'cover',
  // The panel is an instrument face, not a document; pinch-zooming it only
  // ever strands people sideways.
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${condensed.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
