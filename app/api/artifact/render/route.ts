import { NextRequest, NextResponse } from 'next/server'
import { claudeArtifactUrl } from '@/lib/artifact-import'
import { uploadLimiter } from '@/lib/ratelimit'

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY

// Puppeteer function run on Browserless v1: extracts the artifact iframe HTML
// Must use module.exports syntax for Browserless /function endpoint
const EXTRACT_CODE = `
module.exports = async ({ page, context }) => {
  const { url } = context;

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
  await page.waitForSelector('iframe', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));

  // 1. srcdoc property — decoded HTML string, fastest for HTML artifacts
  const srcdoc = await page.evaluate(() => {
    const el = document.querySelector('iframe');
    return el ? el.srcdoc : null;
  });
  if (srcdoc && srcdoc.length > 200) return { data: srcdoc };

  // 2. Frame content — works for React/compiled artifacts
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    try {
      const html = await frame.content();
      if (html && html.length > 200 && !html.includes('chrome-error://')) {
        return { data: html };
      }
    } catch (_) { /* sandboxed frame — skip */ }
  }

  throw new Error('Artifact iframe content could not be extracted');
};
`

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await uploadLimiter.limit(ip)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests. Try again in an hour.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''

  if (!claudeArtifactUrl(url)) {
    return NextResponse.json({ error: 'Invalid Claude artifact URL.' }, { status: 400 })
  }

  if (!BROWSERLESS_TOKEN) {
    return NextResponse.json({ code: 'RENDER_UNAVAILABLE' }, { status: 503 })
  }

  try {
    const res = await fetch(
      `https://chrome.browserless.io/function?token=${BROWSERLESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: EXTRACT_CODE, context: { url } }),
        signal: AbortSignal.timeout(35_000),
      }
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('Browserless error', res.status, text)
      return NextResponse.json(
        { code: 'RENDER_FAILED', error: 'Rendering service returned an error.' },
        { status: 502 }
      )
    }

    const result = await res.json()
    const html: unknown = result?.data

    if (typeof html !== 'string' || html.length < 100) {
      return NextResponse.json(
        { code: 'RENDER_EMPTY', error: 'Could not extract artifact HTML.' },
        { status: 422 }
      )
    }

    return NextResponse.json({ html }, { status: 200 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('TimeoutError')
    return NextResponse.json(
      {
        code: isTimeout ? 'RENDER_TIMEOUT' : 'RENDER_ERROR',
        error: isTimeout ? 'Rendering timed out — try again.' : 'Rendering failed.',
      },
      { status: isTimeout ? 504 : 502 }
    )
  }
}
