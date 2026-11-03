import React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { messages, type Locale } from './i18n';
export type Theme = 'system' | 'light' | 'dark';
export function getPreference(key: string): string | null {
  try { return localStorage.getItem(`scm:${key}`); } catch { return null; }
}
function putPreference(key: string, value: string): void {
  try { localStorage.setItem(`scm:${key}`, value); } catch { /* Private mode can disable storage. */ }
}
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  if (/^\/ru(?:\/|$)/.test(location.pathname)) return 'ru';
  if (/^\/en(?:\/|$)/.test(location.pathname)) return 'en';
  const stored = getPreference('language');
  return stored === 'en' || stored === 'ru' ? stored : navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
const Preferences = createContext<{ locale: Locale; theme: Theme; t: typeof messages.en;
  setLocale: (locale: Locale) => void; setTheme: (theme: Theme) => void } | null>(null);
export function PreferencesProvider({ children, locale: preset }: { children: ReactNode; locale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(preset ?? initialLocale);
  // Keep SSR and hydration identical. CSS follows the system before this effect runs.
  const [theme, updateTheme] = useState<Theme>('system');
  useEffect(() => { const saved = getPreference('theme'); if (saved === 'light' || saved === 'dark') updateTheme(saved); }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <Preferences.Provider value={{ locale, theme, t: messages[locale],
    setLocale: value => { updateLocale(value); putPreference('language', value); },
    setTheme: value => { updateTheme(value); putPreference('theme', value); },
  }}>{children}</Preferences.Provider>;
}
export function usePreferences() {
  const context = useContext(Preferences);
  if (!context) throw new Error('PreferencesProvider is missing');
  return context;
}
export function readFavoriteIds(account: string): Set<number> {
  if (!account) return new Set();
  try {
    const data: unknown = JSON.parse(getPreference(`favorites:${account}`) ?? '[]');
    return new Set(Array.isArray(data) ? data.filter(id => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff).slice(0, 10000) : []);
  } catch { return new Set(); }
}
export function useFavorites(account: string) {
  const [state, setState] = useState(() => ({ account, ids: readFavoriteIds(account) }));
  useEffect(() => { setState({ account, ids: readFavoriteIds(account) }); }, [account]);
  const ids = state.account === account ? state.ids : new Set<number>();
  const toggle = (id: number) => {
    if (!account) return;
    setState(previous => {
      const next = new Set(previous.account === account ? previous.ids : readFavoriteIds(account));
      if (next.has(id)) next.delete(id); else next.add(id);
      putPreference(`favorites:${account}`, JSON.stringify([...next]));
      return { account, ids: next };
    });
  };
  return { favorites: ids, toggleFavorite: toggle };
}
