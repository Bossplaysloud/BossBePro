import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhTW from './zh-TW'
import en from './en'

export const LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
] as const
export type Lang = (typeof LANGUAGES)[number]['code']

const STORAGE_KEY = 'bepro.lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-TW' || saved === 'en') return saved
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { 'zh-TW': { translation: zhTW }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

const syncHtmlLang = (lng: string) => (document.documentElement.lang = lng === 'zh-TW' ? 'zh-Hant' : 'en')
syncHtmlLang(i18n.language)

export function setLang(lang: Lang) {
  void i18n.changeLanguage(lang)
  syncHtmlLang(lang)
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* storage unavailable */
  }
}

export default i18n
