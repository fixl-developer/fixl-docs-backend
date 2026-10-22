export const CLAUDE_EXPORT_PROMPT = 'Export this artifact as one standalone HTML file with all CSS and JavaScript included. Replace React/JSX imports and Claude-only APIs with browser-compatible code. Preserve the design and interactions. Return only the complete HTML file.'

export function claudeArtifactUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const path = url.pathname
    const supported = (url.hostname === 'claude.ai' && /^\/(?:artifact|artifacts|public\/artifacts)\/[A-Za-z0-9_-]+\/?$/.test(path))
      || (url.hostname === 'claude.site' && /^\/artifacts\/[A-Za-z0-9_-]+\/?$/.test(path))
    return supported ? url.href : null
  } catch {
    return null
  }
}

export function normalizeArtifactHtml(value: string): string {
  const fenced = value.trim().match(/^```(?:html)?\s*\r?\n([\s\S]*?)\r?\n```$/i)
  return fenced ? fenced[1] : value
}

export function artifactSourceError(value: string): string | null {
  const source = value.trim()
  if (/^```(?:jsx|tsx|javascript|typescript|react)\b/i.test(source)
    || /^(?:import\s|export\s+default\s|(?:const|function)\s+[A-Z]\w*[^\n]*[=({])/.test(source)) {
    return 'This is React or JavaScript source, not a standalone HTML page. Ask Claude to export a standalone HTML file, then paste or upload that file.'
  }
  if (claudeArtifactUrl(source)) return 'This is a Claude share link. Use the From URL tab for export instructions, or paste the artifact HTML here.'
  return null
}
