import { reactive, watch } from 'vue'
import projectGlobal from 'virtual:project-global'
import en from './en.json'

const storageKey = 'workbench.locale'
const defaultLocale = 'zh-CN'
export const languages = Object.freeze({ 'zh-CN': '简体中文', en: 'English' })

function readLocale() {
  if (Object.hasOwn(languages, projectGlobal.locale)) return projectGlobal.locale
  try {
    const saved = localStorage.getItem(storageKey)
    if (Object.hasOwn(languages, saved)) return saved
  } catch {
    // The workbench can still switch languages when storage is unavailable.
  }
  return defaultLocale
}

export const language = reactive({ locale: readLocale() })

export function translate(message = '', params = {}, context) {
  const key = context ? context + '.' + message : message
  const template = language.locale === 'en' && Object.hasOwn(en, key)
    ? en[key]
    : language.locale === 'en' && Object.hasOwn(en, message) ? en[message] : message
  return template.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match)
}

export const i18n = {
  install(app) {
    app.config.globalProperties.$t = translate
    watch(() => language.locale, locale => {
      document.documentElement.lang = locale
    }, { immediate: true, flush: 'sync' })
  },
}
