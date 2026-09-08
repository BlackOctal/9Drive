import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client'],
  experimental: {
    /*
      Next's client router discards a dynamic route's payload the moment you
      navigate away, so tabbing back re-requests the shell from the server.
      Holding it briefly makes back-navigation feel like what it is — a return
      to something you already had. Auth is still enforced on every API call
      and on any fresh load.
    */
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }] },
}

export default nextConfig
