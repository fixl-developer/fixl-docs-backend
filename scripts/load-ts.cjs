const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

// Transpile the real application modules. Replace only named I/O boundaries in
// tests, so route validation and permission decisions execute unchanged.
function load(relative, mocks = {}) {
  const filename = path.resolve(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks)
    if (name.startsWith('.')) {
      return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts', mocks)
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports)
  return mod.exports
}
module.exports = { load }
