export const CONTEXT_LIMITS = {
  files: 100,
  fileBytes: 96000,
  snapshotBytes: 1000000,
  sources: 6,
  requestBytes: 2400000,
}
const ignored = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.ssh',
  '.aws',
  '.azure',
  '.idea',
])
const extensions = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'md',
  'mdx',
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'py',
  'go',
  'rs',
  'java',
  'cs',
  'rb',
  'php',
  'sql',
  'css',
  'scss',
  'html',
  'htm',
  'xml',
  'vue',
  'svelte',
  'sh',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'graphql',
  'prisma',
])
export function sourcePathError(path: string): string | null {
  if (
    !path ||
    path.length > 300 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\x00-\x1f:]/.test(path)
  )
    return 'Invalid file path'
  const parts = path.split('/'),
    name = parts.at(-1)!.toLowerCase()
  if (parts.some((p) => !p || p === '.' || p === '..')) return 'Invalid file path'
  if (parts.some((p) => ignored.has(p.toLowerCase()))) return 'Generated or private folder'
  if (
    name.startsWith('.env') ||
    /(?:secret|credential|token|password|private[-_]?key)/i.test(name) ||
    /\.(pem|key|p12|pfx|keystore|crt)$/.test(name) ||
    ['.npmrc', '.netrc', '.gitconfig', '.pypirc', 'id_rsa', 'id_ed25519'].includes(name)
  )
    return 'Potential credentials'
  if (/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.(js|css)|\.map)$/.test(name))
    return 'Generated dependency file'
  if (name === 'dockerfile' || name === 'makefile') return null
  return extensions.has(name.split('.').at(-1)!) ? null : 'Unsupported file type'
}
export function contentHasSecret(content: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/.test(
    content,
  )
}
export function validateContextFiles(input: unknown): { path: string; content: string }[] {
  if (!Array.isArray(input) || !input.length || input.length > CONTEXT_LIMITS.files)
    throw new Error('Select between 1 and 100 text files.')
  const seen = new Set<string>()
  let total = 0
  return input.map((value) => {
    if (!value || typeof value.path !== 'string' || typeof value.content !== 'string')
      throw new Error('Each source file needs a path and text content.')
    const reason = sourcePathError(value.path)
    if (reason) throw new Error(value.path + ': ' + reason)
    if (seen.has(value.path)) throw new Error('Duplicate file path: ' + value.path)
    seen.add(value.path)
    const bytes = new TextEncoder().encode(value.content).length
    total += bytes
    if (bytes > CONTEXT_LIMITS.fileBytes) throw new Error(value.path + ': file exceeds 96 KB.')
    if (total > CONTEXT_LIMITS.snapshotBytes)
      throw new Error('Selected files exceed 1 MB. Choose a smaller scope.')
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.content))
      throw new Error(value.path + ': binary file is unsupported.')
    if (contentHasSecret(value.content))
      throw new Error(value.path + ': possible credential detected. Remove it before attaching.')
    return { path: value.path, content: value.content }
  })
}
