import test from 'node:test'
import assert from 'node:assert/strict'
import loader from './load-ts.cjs'
function createGenerator(reason, html) {
  class AnthropicMock {
    messages = {
      create: async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 10 } } }
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: html } }
        yield {
          type: 'message_delta',
          delta: { stop_reason: reason },
          usage: { output_tokens: 20 },
        }
      },
    }
  }
  return loader.load('lib/claude-draft.ts', { '@anthropic-ai/sdk': AnthropicMock })
    .createClaudeDraft
}
test('Claude completes only full HTML as an unsaved draft; truncated generation is rejected', async () => {
  const before = { key: process.env.ANTHROPIC_API_KEY, node: process.env.NODE_ENV }
  process.env.ANTHROPIC_API_KEY = 'test-only-placeholder'
  process.env.NODE_ENV = 'test'
  try {
    const req = () => new Request('https://test.example/api/generate', { method: 'POST' })
    const html = '<!DOCTYPE html><html><head></head><body>Saved separately</body></html>'
    const complete = await createGenerator('end_turn', html)(req(), 'test-user', {
      prompt: 'Create a report',
    })
    const output = await complete.text()
    assert.match(output, /"done":true,"draft":true/)
    assert.doesNotMatch(output, /"version_id"|"storage_key"/)
    for (const [reason, source] of [
      ['max_tokens', html],
      ['end_turn', '<html><body>partial'],
    ]) {
      const response = await createGenerator(reason, source)(req(), 'test-user', {
        prompt: 'Create',
      })
      const stream = await response.text()
      assert.match(stream, /"error"/)
      assert.doesNotMatch(stream, /"done":true/)
    }
    delete process.env.ANTHROPIC_API_KEY
    const outage = await createGenerator('end_turn', html)(req(), 'test-user', { prompt: 'Create' })
    assert.equal(outage.status, 503)
    assert.match((await outage.json()).error, /saved artifacts are still available/)
  } finally {
    if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = before.key
    if (before.node === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before.node
  }
})
