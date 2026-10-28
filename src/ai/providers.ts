// AI providers for sheet recognition. The user brings their own API key; it is stored only in this
// browser (localStorage, never in backups) and sent only to the chosen provider.

import { RECOGNITION_SCHEMA, restoreNulls, withoutNulls, type Recognition } from './schema'

export type Provider = 'anthropic' | 'openai' | 'gemini'
export const PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini']

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: '',
  gemini: '',
}

/** Speech, image-generation, embedding and live-audio variants cannot read a sheet image. */
const UNUSABLE_GEMINI = /(tts|image|embedding|live|audio|robotics|computer-use|-exp|learnlm|gemma|aqa)/

/** A model offered in the settings dropdown. */
export interface ModelOption {
  id: string
  label: string
}

export interface AiSettings {
  provider: Provider
  keys: Partial<Record<Provider, string>>
  models: Partial<Record<Provider, string>>
}

const STORAGE_KEY = 'bepro.ai'

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as AiSettings
      if (PROVIDERS.includes(s.provider)) return { provider: s.provider, keys: s.keys ?? {}, models: s.models ?? {} }
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { provider: 'anthropic', keys: {}, models: {} }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

/** The provider, key and model to use, or null when no key is set. */
export function activeAi(s = loadAiSettings()) {
  const key = s.keys[s.provider]
  if (!key) return null
  let model = s.models[s.provider] || DEFAULT_MODELS[s.provider]
  if (s.provider === 'gemini' && UNUSABLE_GEMINI.test(model)) model = ''
  return { provider: s.provider, key, model }
}

export class AiError extends Error {
  code: 'auth' | 'rate' | 'busy' | 'network' | 'refused' | 'tooLong' | 'badOutput' | 'noModel' | 'noImage' | 'other'
  constructor(code: AiError['code'], message: string = code) {
    super(message)
    this.code = code
  }
}

export interface ImageInput {
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string
}

// ---------- Anthropic (official SDK) ----------

async function anthropicClient(key: string) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // A user-supplied key in a client-only app: there is no server to hide it behind.
  return { Anthropic, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) }
}

async function anthropicError(e: unknown): Promise<AiError> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiError('auth', e.message)
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate', e.message)
  if (e instanceof Anthropic.NotFoundError) return new AiError('noModel', e.message)
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', e.message)
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return new AiError('busy', e.message)
  if (e instanceof Anthropic.APIError) return new AiError('other', e.message)
  return e instanceof AiError ? e : new AiError('other', String(e))
}

const CLAUDE_LINES = ['fable', 'opus', 'sonnet', 'haiku']

/**
 * Claude models that can do this job: image input and structured (JSON-schema) output, still
 * active. Dated snapshots are hidden when their alias is listed. Ordered by tier, newest first.
 */
async function anthropicModels(key: string): Promise<ModelOption[]> {
  try {
    const { client } = await anthropicClient(key)
    const all = []
    for await (const m of client.models.list()) all.push(m)
    const usable = all.filter((m) => {
      if (m.lifecycle && m.lifecycle !== 'active') return false
      const caps = m.capabilities
      if (caps) return caps.image_input.supported && caps.structured_outputs.supported
      return true // capabilities not reported: keep, the API will say if a call is unsupported
    })
    const ids = new Set(usable.map((m) => m.id))
    return usable
      .filter((m) => !(/-\d{8}$/.test(m.id) && ids.has(m.id.replace(/-\d{8}$/, ''))))
      .sort((a, b) => {
        const la = CLAUDE_LINES.indexOf(a.line ?? '')
        const lb = CLAUDE_LINES.indexOf(b.line ?? '')
        return (la === -1 ? 99 : la) - (lb === -1 ? 99 : lb) || b.created_at.localeCompare(a.created_at)
      })
      .map((m) => ({ id: m.id, label: m.display_name || m.id }))
  } catch (e) {
    throw await anthropicError(e)
  }
}

async function anthropicRecognize(key: string, model: string, image: ImageInput, prompt: string, schema: object, signal?: AbortSignal): Promise<string> {
  try {
    const { client } = await anthropicClient(key)
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        // Server-side fallback: if a safety classifier declines, the request is retried on the recommended model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: { type: 'json_schema', schema: withoutNulls(schema as Parameters<typeof withoutNulls>[0]) } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
      { signal },
    )
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new AiError('refused')
    if (message.stop_reason === 'max_tokens') throw new AiError('tooLong')
    return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  } catch (e) {
    throw await anthropicError(e)
  }
}

// ---------- OpenAI (REST) ----------

async function openaiFetch(key: string, path: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`https://api.openai.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new AiError('network', String(e))
  }
  if (res.status === 401 || res.status === 403) throw new AiError('auth', await res.text())
  if (res.status === 429) throw new AiError('rate', await res.text())
  if (res.status === 404) throw new AiError('noModel', await res.text())
  if (res.status >= 500) throw new AiError('busy', await res.text())
  if (!res.ok) throw new AiError('other', await res.text())
  return res.json()
}

/** Families of chat models that accept images, in display order (newest generations first). */
const OPENAI_FAMILIES = [/^gpt-5/, /^gpt-4\.1/, /^gpt-4o/, /^chatgpt-4o/, /^o4/, /^o3/, /^o1/, /^gpt-4-turbo/]
/** Variants that are not general chat-with-images models, need another API, or are just dated copies. */
const OPENAI_EXCLUDE = /(audio|realtime|transcribe|tts|image|search|codex|computer|embedding|moderation|instruct|preview|deep-research|-pro\b|\d{4}-\d{2}-\d{2}|^o1-mini|^o3-mini)/

export function filterOpenAiModels(ids: string[]): ModelOption[] {
  const rank = (id: string) => OPENAI_FAMILIES.findIndex((re) => re.test(id))
  return ids
    .filter((id) => rank(id) !== -1 && !OPENAI_EXCLUDE.test(id))
    .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, 'en', { numeric: true }))
    .map((id) => ({ id, label: id }))
}

async function openaiModels(key: string): Promise<ModelOption[]> {
  const data = (await openaiFetch(key, '/models')) as { data: { id: string }[] }
  return filterOpenAiModels(data.data.map((m) => m.id))
}

async function openaiRecognize(key: string, model: string, image: ImageInput, prompt: string, schema: object, signal?: AbortSignal): Promise<string> {
  const data = (await openaiFetch(key, '/chat/completions', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'sheet_transcription', strict: true, schema } },
    }),
  })) as { choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[] }
  const choice = data.choices[0]
  if (choice?.message.refusal) throw new AiError('refused', choice.message.refusal)
  if (choice?.finish_reason === 'length') throw new AiError('tooLong')
  return choice?.message.content ?? ''
}

// ---------- Google Gemini (REST) ----------


async function geminiFetch(key: string, path: string, init?: RequestInit) {
  let res: Response
  try {
    // The key goes in a header, not the URL, so it does not end up in logs or history.
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta${path}`, {
      ...init,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new AiError('network', String(e))
  }
  if (res.status === 401 || res.status === 403) throw new AiError('auth', await res.text())
  if (res.status === 429) throw new AiError('rate', await res.text())
  if (res.status === 404) throw new AiError('noModel', await res.text())
  if (res.status === 400) {
    const text = await res.text()
    if (/API key/i.test(text)) throw new AiError('auth', text)
    // e.g. "Image input modality is not enabled for models/…-tts": the chosen model cannot see images.
    if (/modality is not enabled|does not support image/i.test(text)) throw new AiError('noImage', text)
    throw new AiError('other', text)
  }
  if (res.status >= 500) throw new AiError('busy', await res.text())
  if (!res.ok) throw new AiError('other', await res.text())
  return res.json()
}

async function geminiModels(key: string): Promise<ModelOption[]> {
  const data = (await geminiFetch(key, '/models?pageSize=200')) as { models: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] }
  const tier = (id: string) => (/-pro/.test(id) ? 0 : /-flash-lite/.test(id) ? 2 : /-flash/.test(id) ? 1 : 3)
  return data.models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name.replace(/^models\//, '') }))
    .filter((m) => !UNUSABLE_GEMINI.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }) || tier(a.id) - tier(b.id))
    .sort((a, b) => tier(a.id) - tier(b.id))
}

async function geminiRecognize(key: string, model: string, image: ImageInput, prompt: string, schema: object, signal?: AbortSignal): Promise<string> {
  const call = (withSchema: boolean) =>
    geminiFetch(key, `/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: image.mime, data: image.base64 } },
              // Without schema enforcement the schema goes into the prompt instead.
              { text: withSchema ? prompt : `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 32768, // the default is too short for a page of TAB
          ...(withSchema ? { responseJsonSchema: schema } : {}),
        },
      }),
    })
  let raw: unknown
  try {
    raw = await call(true)
  } catch (e) {
    // Some models reject JSON-schema enforcement; retry once with the schema in the prompt.
    if (e instanceof AiError && e.code === 'other' && /schema|responseJsonSchema|response_json_schema|Invalid JSON payload/i.test(e.message)) raw = await call(false)
    else throw e
  }
  const data = raw as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
  if (data.promptFeedback?.blockReason) throw new AiError('refused', data.promptFeedback.blockReason)
  const c = data.candidates?.[0]
  if (c?.finishReason === 'MAX_TOKENS') throw new AiError('tooLong')
  if (c?.finishReason === 'SAFETY' || c?.finishReason === 'RECITATION') throw new AiError('refused', c.finishReason)
  return c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
}

// ---------- public API ----------

/** Models this key can use for recognition; also serves as the connection test. */
export function listModels(provider: Provider, key: string): Promise<ModelOption[]> {
  if (provider === 'anthropic') return anthropicModels(key)
  if (provider === 'openai') return openaiModels(key)
  return geminiModels(key)
}

/** A sensible default from a model list when none is chosen yet. */
export function pickModel(provider: Provider, options: ModelOption[]): string {
  const models = options.map((m) => m.id)
  if (provider === 'anthropic') return models.includes(DEFAULT_MODELS.anthropic) ? DEFAULT_MODELS.anthropic : (models[0] ?? DEFAULT_MODELS.anthropic)
  // Lists come ordered best-first; prefer a plain stable name over variants.
  const preferred =
    provider === 'openai'
      ? [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/]
      : [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/, /^gemini-.*pro(-latest)?$/, /^gemini-.*flash(-latest)?$/, /gemini/]
  for (const re of preferred) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models[0] ?? ''
}

/** Sends an image and a prompt and returns the JSON answer, shaped by `schema`. */
export async function requestJson(
  ai: { provider: Provider; key: string; model: string },
  image: ImageInput,
  prompt: string,
  schema: object,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!ai.model) throw new AiError('noModel')
  const text =
    ai.provider === 'anthropic'
      ? await anthropicRecognize(ai.key, ai.model, image, prompt, schema, signal)
      : ai.provider === 'openai'
        ? await openaiRecognize(ai.key, ai.model, image, prompt, schema, signal)
        : await geminiRecognize(ai.key, ai.model, image, prompt, schema, signal)
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    // Claude gets a schema without nullable fields ("" / -1 / [] mean absent).
    return ai.provider === 'anthropic' ? restoreNulls(parsed, schema as Parameters<typeof restoreNulls>[1]) : parsed
  } catch {
    throw new AiError('badOutput', text.slice(0, 500))
  }
}

export async function recognize(
  ai: { provider: Provider; key: string; model: string },
  image: ImageInput,
  prompt: string,
  signal?: AbortSignal,
): Promise<Recognition> {
  const json = (await requestJson(ai, image, prompt, RECOGNITION_SCHEMA, signal)) as Recognition | null
  if (!json || typeof json !== 'object' || !Array.isArray(json.measures)) throw new AiError('badOutput', JSON.stringify(json).slice(0, 500))
  return json
}
