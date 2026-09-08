import type { ConnectedAccount } from '@prisma/client'
import { EXPORT_FORMATS, openFileStream } from './providers/google'
import { fail } from './api'

function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  // RFC 5987 so non-ASCII names survive the trip.
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Pipes a Drive file back to the caller.
 *
 * The caller's Range header is forwarded to Drive and the 206 is passed
 * through untouched, so a browser can seek within a video instead of pulling
 * the whole thing. The body is piped, never buffered — a 4 GB file uses the
 * same memory as a 4 KB one.
 *
 * Both download routes share this. They differ only in how they resolve the
 * file: one from a File row, one from a Drive id in a verified account.
 */
export async function streamDriveFile(
  account: ConnectedAccount,
  providerFileId: string,
  file: { name: string; mimeType: string },
  options: { download: boolean; range: string | null },
): Promise<Response> {
  const upstream = await openFileStream(account, providerFileId, file.mimeType, options.range)

  if (!upstream.ok || !upstream.body) {
    return fail(upstream.status === 404 ? 404 : 502, 'Google could not serve that file.', 'UPSTREAM')
  }

  const exportAs = EXPORT_FORMATS[file.mimeType]
  const name =
    exportAs && !file.name.toLowerCase().endsWith(exportAs.extension) ? file.name + exportAs.extension : file.name

  const headers = new Headers({
    'Content-Type': exportAs?.mimeType ?? file.mimeType,
    'Content-Disposition': contentDisposition(options.download ? 'attachment' : 'inline', name),
    'Cache-Control': 'private, max-age=0, must-revalidate',
  })
  // Exports are generated per request and have no stable byte range.
  if (!exportAs) headers.set('Accept-Ranges', 'bytes')
  for (const h of ['content-length', 'content-range'] as const) {
    const value = upstream.headers.get(h)
    if (value) headers.set(h, value)
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}
