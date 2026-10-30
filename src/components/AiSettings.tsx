import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AiError, DEFAULT_MODELS, PROVIDERS, aiErrorKey, listModels, loadAiSettings, pickModel, probeModel, providerOfKey, saveAiSettings, type AiSettings, type ModelOption, type Provider } from '../ai/providers'
import { useToast } from './Toast'

const KEY_PAGES: Record<Provider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
}

/** What the last connection test found: the key (model list), then one real request to the model. */
interface TestResult {
  provider: Provider
  keyOk: boolean
  keyMessage?: string
  count?: number
  model?: string
  modelOk?: boolean
  modelMessage?: string
}

/** Provider, API key and model for image recognition. Keys stay in this browser only. */
export function AiSettingsPanel() {
  const { t } = useTranslation()
  const toast = useToast()
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const provider = settings.provider
  const key = settings.keys[provider] ?? ''
  const model = settings.models[provider] || DEFAULT_MODELS[provider]

  const update = (next: AiSettings) => {
    setSettings(next)
    saveAiSettings(next)
  }

  const setProvider = (p: Provider) => {
    update({ ...settings, provider: p })
    setModels([])
    setDraft('')
    setResult(null)
  }

  const saveKey = () => {
    const k = draft.trim()
    if (!k) return
    // A key pasted under the wrong service goes to the service it belongs to.
    const owner = providerOfKey(k)
    const p = owner && owner !== provider ? owner : provider
    if (p !== provider) {
      setModels([])
      toast(t('ai.keyDetected', { provider: t(`ai.provider.${p}`) }))
    }
    update({ ...settings, provider: p, keys: { ...settings.keys, [p]: k } })
    setDraft('')
    void test(k, p)
  }

  const test = async (k = key, p = provider) => {
    if (!k) return
    setTesting(true)
    setResult(null)
    try {
      // 1. The key: can it list the models?
      let list: ModelOption[]
      try {
        list = await listModels(p, k)
      } catch (e) {
        setResult({ provider: p, keyOk: false, keyMessage: t(aiErrorKey(e)) })
        return
      }
      setModels(list)
      const saved = loadAiSettings().models[p] || DEFAULT_MODELS[p]
      const chosen = saved && list.some((m) => m.id === saved) ? saved : pickModel(p, list)
      if (saved && chosen !== saved && loadAiSettings().models[p]) toast(t('ai.modelReplaced', { from: saved, to: chosen }))
      setSettings((s) => {
        const next = { ...s, provider: p, keys: { ...s.keys, [p]: k }, models: { ...s.models, [p]: chosen } }
        saveAiSettings(next)
        return next
      })
      // 2. The model: one tiny real request with a picture (quota, image input).
      const err = chosen ? await probeModel(p, k, chosen) : new AiError('noModel')
      setResult({ provider: p, keyOk: true, count: list.length, model: chosen, modelOk: !err, modelMessage: err ? t(aiErrorKey(err)) : undefined })
    } finally {
      setTesting(false)
    }
  }

  const clearKey = () => {
    const keys = { ...settings.keys }
    delete keys[provider]
    update({ ...settings, keys })
    setModels([])
    setResult(null)
    toast(t('ai.keyCleared'))
  }

  const masked = key ? `${key.slice(0, 7)}…${key.slice(-4)}` : ''
  const steps = t(`ai.guide.${provider}`, { returnObjects: true }) as unknown as string[]
  const shown = result?.provider === provider ? result : null

  return (
    <section className="panel">
      <h2>{t('ai.settingsTitle')}</h2>
      <p className="muted small" style={{ marginTop: -6 }}>{t('ai.settingsHint')}</p>
      <div className="setting-row">
        <span>{t('ai.providerLabel')}</span>
        <div className="segmented" role="group" aria-label={t('ai.providerLabel')}>
          {PROVIDERS.map((p) => (
            <button key={p} aria-pressed={provider === p} onClick={() => setProvider(p)}>
              {t(`ai.provider.${p}`)}
              {settings.keys[p] ? ' ●' : ''}
            </button>
          ))}
        </div>
      </div>
      <details className="ai-guide" open={!key}>
        <summary>{t('ai.guideTitle')}</summary>
        {provider !== 'gemini' && <p className="muted small" style={{ margin: '6px 0' }}>{t('ai.guideFree')}</p>}
        <ol className="small">
          {(Array.isArray(steps) ? steps : []).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>
      <div className="setting-row">
        <div>
          <div>{t('ai.apiKey')}</div>
          <div className="muted small">
            {key ? t('ai.keySaved', { key: reveal ? key : masked }) : t('ai.noKeyYet')}{' '}
            <a href={KEY_PAGES[provider]} target="_blank" rel="noreferrer">{t('ai.getKey')}</a>
          </div>
        </div>
        <div className="row">
          {key && <button className="btn btn-ghost" onClick={() => setReveal(!reveal)}>{reveal ? t('ai.hide') : t('ai.show')}</button>}
          {key && <button className="btn btn-danger" onClick={clearKey}>{t('ai.clearKey')}</button>}
        </div>
      </div>
      <div className="setting-row">
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={key ? t('ai.replaceKey') : t('ai.pasteKey')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn btn-primary" onClick={saveKey} disabled={!draft.trim()}>{t('common.save')}</button>
      </div>
      <div className="setting-row">
        <div>
          <div>{t('ai.model')}</div>
          <div className="muted small">{t('ai.modelHint')}</div>
        </div>
        <div className="row">
          {models.length > 0 ? (
            <select
              className="select"
              style={{ width: 'auto', maxWidth: 260 }}
              value={model}
              onChange={(e) => {
                update({ ...settings, models: { ...settings.models, [provider]: e.target.value } })
                setResult(null)
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label}（${m.id}）`}</option>
              ))}
            </select>
          ) : (
            <code className="small">{model || t('ai.noModel')}</code>
          )}
          <button className="btn" onClick={() => void test()} disabled={!key || testing}>{testing ? t('ai.testing') : t('ai.test')}</button>
        </div>
      </div>
      {shown && (
        <ul className="ai-test" aria-live="polite">
          <li className={shown.keyOk ? 'ok' : 'fail'}>{shown.keyOk ? t('ai.testKeyOk', { count: shown.count }) : t('ai.testKeyFail', { message: shown.keyMessage })}</li>
          {shown.keyOk && (
            <li className={shown.modelOk ? 'ok' : 'fail'}>
              {shown.modelOk ? t('ai.testModelOk', { model: shown.model }) : t('ai.testModelFail', { model: shown.model, message: shown.modelMessage })}
            </li>
          )}
        </ul>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>{t('ai.testNote')}</p>
      <p className="muted small" style={{ margin: '8px 0 0' }}>{t('ai.keyWarning')}</p>
    </section>
  )
}
