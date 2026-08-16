import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICTIONARIES, DEFAULT_LOCALE } from './dictionaries.js';
import {
  formatNpr,
  formatAdAsBs,
  formatBs,
  adToBs,
  formatAge as formatAgeRaw,
  formatAddress as formatAddressRaw,
} from '../utils/nepal.js';

const I18nContext = createContext(null);

const STORAGE_KEY = 'hms.locale.v2';

/**
 * Locale, translations, and the locale-aware formatters.
 *
 * Dates, money and addresses are exposed from here rather than imported
 * directly by each component for one reason: they all need to know the current
 * locale, and threading it through every call site is exactly how a page ends
 * up rendering half its dates in BS and half in Gregorian.
 */
export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALE,
  );

  const setLocale = useCallback((next) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // Keep the document language in sync so screen readers announce Devanagari
  // correctly and the browser picks sensible fonts.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  /**
   * Translate. Falls back to English, then to the key itself — a missing entry
   * shows up as `patient.mrn` in the UI, which is ugly and therefore gets
   * noticed and fixed, rather than rendering blank and looking like no data.
   */
  const t = useCallback(
    (key, fallback) =>
      DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en?.[key] ?? fallback ?? key,
    [locale],
  );

  const value = useMemo(() => {
    const isNepali = locale === 'ne';

    return {
      locale,
      setLocale,
      t,
      isNepali,

      /** Money, always NPR, grouped the South Asian way. */
      money: (amount, options) => formatNpr(amount, { locale, ...options }),

      /**
       * A date, in Bikram Sambat when the user is reading Nepali.
       * Every date shown to a user goes through here.
       */
      date: (value, options) =>
        isNepali
          ? formatAdAsBs(value, { locale, ...options })
          : new Date(value).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              ...(options?.withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
            }),

      /** The BS parts of a date, for a picker or a period selector. */
      toBs: (value) => adToBs(value),
      formatBs: (bs, options) => formatBs(bs, { locale, ...options }),

      age: (dateOfBirth, options) => formatAgeRaw(dateOfBirth, { locale, ...options }),
      address: (value, options) => formatAddressRaw(value, { locale, ...options }),
    };
  }, [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
