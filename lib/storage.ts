import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = process.env.STORAGE_BUCKET ?? 'reports'

async function upload(key: string, buf: Buffer): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(key, buf, {
    contentType: 'text/html; charset=utf-8',
    upsert: true,
  })

  // If bucket doesn't exist, create it and retry once
  if (error?.message?.includes('Bucket not found')) {
    await supabase.storage.createBucket(BUCKET, { public: false })
    const { error: retryErr } = await supabase.storage.from(BUCKET).upload(key, buf, {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    })
    if (retryErr) throw new Error(`Storage upload failed: ${retryErr.message}`)
    return
  }

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

export async function uploadObject(key: string, html: string): Promise<void> {
  await upload(key, Buffer.from(html, 'utf-8'))
}

export async function fetchObject(key: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(key)
  if (error || !data) throw new Error(`Storage fetch failed: ${error?.message ?? 'empty response'}`)
  return data.text()
}

// ─── Legacy snippet helpers ───────────────────────────────────────────────────

export async function uploadSnippet(slug: string, html: string): Promise<void> {
  return uploadObject(`snippets/${slug}.html`, html)
}

export async function fetchSnippet(slug: string): Promise<string> {
  return fetchObject(`snippets/${slug}.html`)
}
