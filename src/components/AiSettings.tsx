import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AiError, DEFAULT_MODELS, PROVIDERS, listModels, loadAiSettings, pickModel, saveAiSettings, type AiSettings, type ModelOption, type Provider } from '../ai/providers'
import { useToast } from './Toast'

const KEY_PAGES: Record<Provider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
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
  }

  const saveKey = () => {
    const k = draft.trim()
    if (!k) return
    update({ ...settings, keys: { ...settings.keys, [provider]: k } })
    setDraft('')
    void test(k)
  }

  const test = async (k = key) => {
    if (!k) return
    setTesting(true)
    try {
      const list = await listModels(provider, k)
      setModels(list)
      const saved = settings.models[provider]
      const chosen = saved && list.some((m) => m.id === saved) ? saved : pickModel(provider, list)
      setSettings((s) => {
        const next = { ...s, keys: { ...s.keys, [provider]: k }, models: { ...s.models, [provider]: chosen } }
        saveAiSettings(next)
        return next
      })
      toast(t('ai.testOk', { count: list.length }))
    } catch (e) {
      toast(t(`ai.error.${e instanceof AiError ? e.code : 'other'}`))
    } finally {
      setTesting(false)
    }
  }

  const clearKey = () => {
    const keys = { ...settings.keys }
    delete keys[provider]
    update({ ...settings, keys })
    setModels([])
    toast(t('ai.keyCleared'))
  }

  const masked = key ? `${key.slice(0, 7)}…${key.slice(-4)}` : ''

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
              onChange={(e) => update({ ...settings, models: { ...settings.models, [provider]: e.target.value } })}
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
      <p className="muted small" style={{ margin: '8px 0 0' }}>{t('ai.keyWarning')}</p>
    </section>
  )
}
