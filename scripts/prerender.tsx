import React from 'react';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { renderToString } from 'react-dom/server';
import { PublicApp } from '../src/client/public-app';
import { PreferencesProvider } from '../src/client/preferences';
import { messages, type Locale } from '../src/client/i18n';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const configured = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
const url = configured ? new URL(configured) : null;
if (url && (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')) throw new Error('SITE_URL must be an HTTPS origin');
// No placeholder canonical is published when a domain is not configured. The local preview is intentionally noindex.
const origin = url?.origin ?? '';
const indexable = Boolean(origin) && process.env.VERCEL_ENV !== 'preview';
const template = await readFile('dist/public/public.html', 'utf8');
for (const locale of ['en', 'ru'] as Locale[]) {
  const t = messages[locale];
  const title = `${t.publicTitle} — Steam Cloud Manager`;
  const path = `/${locale}/`;
  const meta = [`<meta name="description" content="${escape(t.description)}" />`,
    `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}" />`,
    '<meta property="og:type" content="website" />', `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(t.description)}" />`,
    `<meta property="og:locale" content="${locale === 'ru' ? 'ru_RU' : 'en_US'}" />`,
    '<meta name="twitter:card" content="summary" />'];
  if (origin) meta.push(`<link rel="canonical" href="${escape(origin + path)}" />`,
    `<link rel="alternate" hreflang="en" href="${escape(origin + '/en/')}" />`,
    `<link rel="alternate" hreflang="ru" href="${escape(origin + '/ru/')}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escape(origin + '/en/')}" />`,
    `<meta property="og:url" content="${escape(origin + path)}" />`);
  const html = template.replace('<html lang="en">', `<html lang="${locale}">`)
    .replace('<title>Steam Cloud Manager</title>', `<title>${escape(title)}</title>`)
    .replace('<!--SEO-->', meta.join('\n'))
    .replace('<!--APP-->', renderToString(<PreferencesProvider locale={locale}><PublicApp /></PreferencesProvider>));
  await mkdir(`dist/public/${locale}`, { recursive: true });
  await writeFile(`dist/public/${locale}/index.html`, html);
  if (locale === 'en') await writeFile('dist/public/index.html', html);
}
await rm('dist/public/public.html');
await writeFile('dist/public/robots.txt', indexable
  ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await writeFile('dist/public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin ? ['en', 'ru'].map(locale => `<url><loc>${escape(origin + '/' + locale + '/')}</loc></url>`).join('') : ''}</urlset>`);
console.log(`Public static site built: en/ru; indexable=${indexable}; no Steam API deployed.`);
