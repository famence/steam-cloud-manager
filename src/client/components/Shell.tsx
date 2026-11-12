import React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Cloud, Github, LogOut, ShieldCheck, X } from 'lucide-react';
import { usePreferences, type Theme } from '../preferences';
import type { Locale } from '../i18n';
export const REPOSITORY = 'https://github.com/famence/steam-cloud-manager';

export function withBase(path: string): string {
  const rawBase = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.BASE_URL)
    || (typeof process !== 'undefined' && process.env && (process.env.BASE_PATH || process.env.SITE_URL))
    || '/';
  let base = '/';
  if (typeof rawBase === 'string') {
    if (rawBase.startsWith('http://') || rawBase.startsWith('https://')) {
      try {
        base = new URL(rawBase).pathname;
      } catch {
        base = '/';
      }
    } else {
      base = rawBase;
    }
  }
  const stripped = base.replace(/^\/+|\/+$/g, '');
  base = stripped ? `/${stripped}/` : '/';
  const cleanPath = path.replace(/^\/+/, '');
  return `${base}${cleanPath}`;
}

export function SecurityContent() {
  const { t } = usePreferences();
  return <div className="security-copy"><p>{t.securityLocal}</p><p>{t.securityPublic}</p>
    <p>{t.securityStorage}</p><p>{t.securityControls}</p><p className="security-caution">{t.securityLimits}</p>
    <a href={`${REPOSITORY}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">SECURITY.md</a></div>;
}
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function SecurityDialog({ onClose }: { onClose: () => void }) {
  const { t } = usePreferences();
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  );

  useEffect(() => {
    if (document.activeElement && !ref.current?.contains(document.activeElement)) {
      previousFocus.current = document.activeElement as HTMLElement | null;
    }
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previousFocus.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const dialog = ref.current;
    if (!dialog) return;
    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return <dialog ref={ref} className="dialog security-dialog" onCancel={onClose} onKeyDown={handleKeyDown} aria-labelledby="security-title">
    <div className="dialog-top"><h2 id="security-title">{t.securityTitle}</h2><button className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
    <SecurityContent /><div className="dialog-actions"><button className="button" onClick={onClose}>{t.close}</button></div>
  </dialog>;
}
export function Shell({ children, publicSite = false, onHome, account, onLogout, busy = false }: {
  children: ReactNode; publicSite?: boolean; onHome?: () => void; account?: string; onLogout?: () => void; busy?: boolean;
}) {
  const { locale, theme, setLocale, setTheme, t } = usePreferences();
  const [securityOpen, setSecurityOpen] = useState(false);
  return <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      {publicSite ? <a className="brand" href={withBase(`/${locale}/`)}><Cloud size={23} /><span>Steam Cloud Manager</span></a>
        : <button className="brand" onClick={onHome} disabled={busy}><Cloud size={23} /><span>Steam Cloud Manager</span></button>}
      <div className="header-controls">
        {publicSite ? <nav className="language-links" aria-label={t.language}><a href={withBase('/en/')} hrefLang="en" lang="en" aria-current={locale === 'en' ? 'page' : undefined}>EN</a><a href={withBase('/ru/')} hrefLang="ru" lang="ru" aria-current={locale === 'ru' ? 'page' : undefined}>RU</a></nav>
          : <label className="compact-select"><span className="sr-only">{t.language}</span><select value={locale} onChange={e => setLocale(e.target.value as Locale)} aria-label={t.language}><option value="en">EN</option><option value="ru">RU</option></select></label>}
        <label className="compact-select"><span className="sr-only">{t.theme}</span><select value={theme} onChange={e => setTheme(e.target.value as Theme)} aria-label={t.theme}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></label>
        <button className="icon-button" aria-label={t.security} title={t.security} onClick={() => setSecurityOpen(true)}><ShieldCheck size={20} /></button>
        {onLogout && <><span className="account-name" title={account}>{account}</span><button className="icon-button" aria-label={t.signOut} title={t.signOut} onClick={onLogout} disabled={busy}><LogOut size={19} /></button></>}
      </div>
    </div></header>
    {children}
    <footer className="app-footer"><span>made by <a href="https://github.com/famence" target="_blank" rel="noreferrer">@famence</a></span><a className="github-link" href={REPOSITORY} target="_blank" rel="noreferrer"><Github size={17} aria-hidden="true" />GitHub</a></footer>
    {securityOpen && <SecurityDialog onClose={() => setSecurityOpen(false)} />}
  </div>;
}
