import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

const endpoint = process.env.STORAGE_ENDPOINT
  ?? `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

const r2 = new S3Client({
  region: process.env.STORAGE_REGION ?? 'auto',
  endpoint,
  forcePathStyle: !!process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!

export async function uploadSnippet(slug: string, html: string): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `snippets/${slug}.html`,
      Body: html,
      ContentType: 'text/html; charset=utf-8',
    })
  )
}

export async function fetchSnippet(slug: string): Promise<string> {
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: `snippets/${slug}.html`,
    })
  )

  const body = response.Body
  if (!body) throw new Error('Empty response from storage')

  return await body.transformToString('utf-8')
}
