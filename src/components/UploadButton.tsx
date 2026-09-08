'use client'

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { useUploads } from '@/lib/client/uploader'

export function UploadButton({ folderId = null }: { folderId?: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const enqueue = useUploads((s) => s.enqueue)

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void enqueue(files, folderId)
        }}
      />
      <button
        onClick={() => input.current?.click()}
        className="flex items-center gap-2 rounded-sm bg-signal px-3 py-2 text-xs font-semibold text-void transition-opacity hover:opacity-90"
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={2} />
        Upload
      </button>
    </>
  )
}
