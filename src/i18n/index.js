import { catalogs, supportedLocales } from './catalogs.js';
import { AppError } from '../domain/errors.js';

export { supportedLocales };

export function normalizeLocale(locale) {
  if (supportedLocales.includes(locale)) return locale;
  if (locale?.toLowerCase().startsWith('fr')) return 'fr-CA';
  if (locale?.toLowerCase().startsWith('es')) return 'es-US';
  if (locale?.toLowerCase() === 'en-ca') return 'en-CA';
  return 'en-US';
}

export function placeholders(message) {
  return [...message.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

export function translate(locale, key, values = {}) {
  const resolved = normalizeLocale(locale);
  const message = catalogs[resolved][key];
  if (message === undefined) throw new AppError('MISSING_TRANSLATION', `Missing ${resolved} translation for ${key}.`, { locale: resolved, key });
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    if (!(name in values)) throw new AppError('MISSING_TRANSLATION_VALUE', `Missing translation value ${name}.`, { key, name });
    return String(values[name]);
  });
}

export function formatMoney(locale, currency, cents) {
  if (!Number.isSafeInteger(cents)) throw new AppError('INVALID_MONEY', 'Money must be safe integer cents.');
  return new Intl.NumberFormat(normalizeLocale(locale), { style: 'currency', currency }).format(cents / 100);
}

export function validateCatalogs() {
  const baseKeys = Object.keys(catalogs['en-US']).sort();
  const findings = [];
  for (const locale of supportedLocales) {
    const keys = Object.keys(catalogs[locale]).sort();
    const missing = baseKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !baseKeys.includes(key));
    for (const key of baseKeys.filter((candidate) => keys.includes(candidate))) {
      const expected = placeholders(catalogs['en-US'][key]);
      const actual = placeholders(catalogs[locale][key]);
      if (expected.join('|') !== actual.join('|')) findings.push({ locale, key, type: 'PLACEHOLDER_MISMATCH', expected, actual });
    }
    for (const key of missing) findings.push({ locale, key, type: 'MISSING_KEY' });
    for (const key of extra) findings.push({ locale, key, type: 'EXTRA_KEY' });
  }
  return findings;
}
