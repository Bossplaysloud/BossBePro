import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeAi, filterOpenAiModels, listModels, pickModel } from './providers'

const geminiList = [
  'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-image', 'gemini-embedding-001',
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-live-2.5-flash-preview',
]

describe('gemini models', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('lists only models that can read images and picks a pro model', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ models: geminiList.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 }),
    )
    const models = await listModels('gemini', 'k')
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'])
    expect(pickModel('gemini', models)).toBe('gemini-2.5-pro')
    expect(pickModel('gemini', [{ id: 'gemini-2.5-flash', label: '' }, { id: 'gemini-2.0-flash', label: '' }])).toBe('gemini-2.5-flash')
  })

  it('ignores a stored model that cannot read images', () => {
    const store = new Map([['bepro.ai', JSON.stringify({ provider: 'gemini', keys: { gemini: 'k' }, models: { gemini: 'gemini-2.5-flash-preview-tts' } })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} })
    expect(activeAi()).toEqual({ provider: 'gemini', key: 'k', model: '' })
  })
})

describe('openai models', () => {
  it('keeps chat models that accept images, newest families first', () => {
    const ids = [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-4o-transcribe', 'gpt-4o-mini-tts',
      'gpt-4o-search-preview', 'gpt-image-1', 'gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'dall-e-3', 'whisper-1', 'tts-1', 'text-embedding-3-large',
      'omni-moderation-latest', 'o1', 'o1-mini', 'o1-pro', 'o3', 'o3-mini', 'o4-mini', 'codex-mini-latest', 'computer-use-preview',
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-5-codex', 'gpt-5-pro', 'babbage-002',
    ]
    expect(filterOpenAiModels(ids).map((m) => m.id)).toEqual([
      'gpt-5-nano', 'gpt-5-mini', 'gpt-5-chat-latest', 'gpt-5', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'o4-mini', 'o3', 'o1', 'gpt-4-turbo',
    ])
    expect(pickModel('openai', filterOpenAiModels(ids))).toBe('gpt-5')
  })
})

describe('claude models', () => {
  it('keeps active models with image input and structured outputs, best tier first', async () => {
    const caps = (image: boolean, structured: boolean) => ({ image_input: { supported: image }, structured_outputs: { supported: structured } })
    const m = (id: string, line: string, created: string, c: object | null, lifecycle = 'active') => ({ type: 'model', id, display_name: id.toUpperCase(), created_at: created, line, lifecycle, capabilities: c })
    const data = [
      m('claude-haiku-4-5', 'haiku', '2025-10-01T00:00:00Z', caps(true, true)),
      m('claude-sonnet-5-5', 'sonnet', '2026-08-01T00:00:00Z', caps(true, true)),
      m('claude-opus-4-6', 'opus', '2026-02-01T00:00:00Z', caps(true, false)), // no structured outputs
      m('claude-opus-5-5', 'opus', '2026-09-01T00:00:00Z', caps(true, true)),
      m('claude-opus-5', 'opus', '2026-05-01T00:00:00Z', caps(true, true)),
      m('claude-opus-5-20260501', 'opus', '2026-05-01T00:00:00Z', caps(true, true)), // dated copy of an alias
      m('claude-3-haiku-20240307', 'haiku', '2024-03-07T00:00:00Z', caps(true, false), 'retired'),
      m('claude-fable-5-1', 'fable', '2026-08-15T00:00:00Z', caps(true, true)),
    ]
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data, has_more: false, first_id: null, last_id: null }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const models = await listModels('anthropic', 'k')
    expect(models.map((x) => x.id)).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'])
    expect(models[1].label).toBe('CLAUDE-OPUS-5-5')
    expect(pickModel('anthropic', models)).toBe('claude-opus-5-5')
  })
})

describe('schema for Claude', () => {
  it('has no union types and maps absent values back to null', async () => {
    const { CLAUDE_SCHEMA, RECOGNITION_SCHEMA, restoreNulls } = await import('./schema')
    expect(JSON.stringify(CLAUDE_SCHEMA)).not.toMatch(/"type":\[/)
    const back = restoreNulls(
      { notation: 'chord', title: '', strings: -1, tuning: [], tempo: 72, capo: -1, measures: [], warnings: [], chart: { originalKey: 'Ab', sections: [{ label: '', lines: [{ bars: [{ segments: [{ chord: '', lyric: '', x: -1 }] }], lyricStart: 12 }] }] } },
      RECOGNITION_SCHEMA,
    ) as Record<string, unknown>
    expect(back).toMatchObject({ title: null, strings: null, tuning: null, tempo: 72, capo: null, warnings: [], chart: { originalKey: 'Ab', sections: [{ label: null, lines: [{ bars: [{ segments: [{ chord: null, lyric: '', x: null }] }], lyricStart: 12 }] }] } })
  })
})
