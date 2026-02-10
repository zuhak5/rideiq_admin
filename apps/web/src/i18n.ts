import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const LOCALE_STORAGE_KEY = 'rideiq_locale';

export const supportedLanguages = ['en', 'ar'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function normalizeLanguage(input?: string | null): SupportedLanguage {
  if (!input) return 'en';
  const lower = input.toLowerCase();
  if (lower.startsWith('ar')) return 'ar';
  return 'en';
}

export function applyDocumentLocale(lang: SupportedLanguage) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

const initialLang = (() => {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch {
    // ignore
  }
  if (typeof navigator !== 'undefined') return normalizeLanguage(navigator.language);
  return 'en' as const;
})();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

applyDocumentLocale(initialLang);

export default i18n;
