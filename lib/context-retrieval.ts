import type { ContextSource, SourceReference } from '@/types/workspace'
export function retrieveContext(sources: ContextSource[], prompt: string, budget = 60000) {
  const terms = [...new Set(prompt.toLowerCase().match(/[a-z0-9_./-]{3,}/g) || [])].slice(0, 80)
  const ranked = sources
    .flatMap((s) =>
      s.files.map((f) => {
        const path = f.path.toLowerCase(),
          text = f.content.toLowerCase()
        const score =
          terms.reduce((n, t) => n + (path.includes(t) ? 12 : 0) + (text.includes(t) ? 1 : 0), 0) +
          (/readme/i.test(path) ? 2 : 0)
        return { s, f, score }
      }),
    )
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))
  const references: SourceReference[] = [],
    blocks: string[] = []
  let remaining = budget
  for (const { s, f } of ranked) {
    const label = JSON.stringify({ source: s.label, path: f.path, commit: s.commit })
    const allowance = Math.min(12000, remaining - label.length - 100)
    if (allowance < 200) break
    const content = f.content.slice(0, allowance),
      truncated = content.length < f.content.length
    blocks.push(
      'SOURCE ' +
        label +
        '\n' +
        content +
        (truncated ? '\n[File excerpt truncated]' : '') +
        '\nEND SOURCE',
    )
    references.push({ source: s.label, path: f.path, commit: s.commit, truncated })
    remaining -= label.length + content.length + 100
  }
  return { text: blocks.join('\n\n'), references, omitted: ranked.length - references.length }
}
