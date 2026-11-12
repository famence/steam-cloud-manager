import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { PublicApp } from '../src/client/public-app';
import { PreferencesProvider } from '../src/client/preferences';
import { messages, type Locale } from '../src/client/i18n';

export const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const escape = escapeHtml;

export function validateSiteUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || Boolean(url.username) || Boolean(url.password) || Boolean(url.search) || Boolean(url.hash)) {
    throw new Error('SITE_URL must be an HTTPS URL without credentials, query parameters, or hash');
  }
  return url;
}

export function resolveSiteBase(siteUrlConfig?: string, basePathConfig?: string) {
  const configured = siteUrlConfig || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const url = configured ? validateSiteUrl(configured) : null;
  const urlSubpath = url ? url.pathname.replace(/^\/+|\/+$/g, '') : '';
  const rawBasePath = (basePathConfig !== undefined ? basePathConfig : (process.env.BASE_PATH || '')).trim();
  const envBasePath = rawBasePath.replace(/^\/+|\/+$/g, '');
  const cleanSub = urlSubpath || envBasePath;
  const subpath = cleanSub ? `/${cleanSub}` : '';
  const siteBase = url ? `${url.origin}${subpath}` : '';
  const resolvedBasePath = subpath ? `${subpath}/` : '/';
  const indexable = Boolean(siteBase) && process.env.VERCEL_ENV !== 'preview';

  return { url, siteBase, subpath, basePath: resolvedBasePath, indexable };
}

export function generateRobotsTxt(siteBase: string, indexable: boolean): string {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${siteBase}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
}

export function generateSitemapXml(siteBase: string, locales: readonly Locale[] = ['en', 'ru']): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    siteBase ? locales.map(locale => `<url><loc>${escapeHtml(`${siteBase}/${locale}/`)}</loc></url>`).join('') : ''
  }</urlset>`;
}

export function buildSeoMeta(locale: Locale, siteBase: string, indexable: boolean, staticCsp = ''): string[] {
  const t = messages[locale];
  const title = `${t.publicTitle} — Steam Cloud Manager`;
  const cleanSiteBase = siteBase ? siteBase.replace(/\/+$/, '') : '';
  const pagePath = `/${locale}/`;
  const meta: string[] = [];
  if (staticCsp) {
    meta.push(`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(staticCsp)}" />`);
  }
  meta.push(
    `<meta name="description" content="${escapeHtml(t.description)}" />`,
    `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(t.description)}" />`,
    `<meta property="og:locale" content="${locale === 'ru' ? 'ru_RU' : 'en_US'}" />`,
    '<meta name="twitter:card" content="summary" />'
  );
  if (cleanSiteBase) {
    meta.push(
      `<link rel="canonical" href="${escapeHtml(`${cleanSiteBase}${pagePath}`)}" />`,
      `<link rel="alternate" hreflang="en" href="${escapeHtml(`${cleanSiteBase}/en/`)}" />`,
      `<link rel="alternate" hreflang="ru" href="${escapeHtml(`${cleanSiteBase}/ru/`)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${cleanSiteBase}/en/`)}" />`,
      `<meta property="og:url" content="${escapeHtml(`${cleanSiteBase}${pagePath}`)}" />`
    );
  }
  return meta;
}

export interface PrerenderOptions {
  outDir?: string;
  templatePath?: string;
  siteUrl?: string;
  basePath?: string;
  deleteTemplate?: boolean;
}

export async function prerenderSite(options: PrerenderOptions = {}): Promise<{
  outDir: string;
  siteBase: string;
  indexable: boolean;
}> {
  const outDir = path.resolve(options.outDir || 'dist/public');
  const configured = options.siteUrl !== undefined
    ? options.siteUrl
    : (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
  const rawBasePath = options.basePath !== undefined ? options.basePath : process.env.BASE_PATH;
  const { siteBase, subpath, indexable } = resolveSiteBase(configured, rawBasePath);

  if (subpath && !process.env.BASE_PATH) {
    process.env.BASE_PATH = `${subpath}/`;
  }

  let staticCsp = '';
  try {
    const vercelConfig = JSON.parse(await readFile('vercel.json', 'utf8'));
    const headerCsp = vercelConfig.headers?.flatMap((x: { headers: Array<{ key: string; value: string }> }) => x.headers)?.find((x: { key: string }) => x.key === 'Content-Security-Policy')?.value ?? '';
    staticCsp = headerCsp.replace(/;\s*frame-ancestors\s+[^;]+/g, '').trim();
  } catch {
    // Default fallback
  }

  const templatePath = options.templatePath || (existsSync('dist/public/public.html') ? 'dist/public/public.html' : 'src/client/public.html');
  const template = await readFile(templatePath, 'utf8');

  for (const locale of ['en', 'ru'] as Locale[]) {
    const t = messages[locale];
    const title = `${t.publicTitle} — Steam Cloud Manager`;
    const meta = buildSeoMeta(locale, siteBase, indexable, template.includes('http-equiv="Content-Security-Policy"') ? '' : staticCsp);

    const html = template.replace('<html lang="en">', `<html lang="${locale}">`)
      .replace('<title>Steam Cloud Manager</title>', `<title>${escapeHtml(title)}</title>`)
      .replace('<!--SEO-->', meta.join('\n'))
      .replace('<!--APP-->', renderToString(<PreferencesProvider locale={locale}><PublicApp /></PreferencesProvider>));

    await mkdir(path.join(outDir, locale), { recursive: true });
    await writeFile(path.join(outDir, `${locale}/index.html`), html);
    if (locale === 'en') {
      await writeFile(path.join(outDir, 'index.html'), html);
    }
  }

  const shouldDeleteTemplate = options.deleteTemplate ?? (templatePath === 'dist/public/public.html');
  if (shouldDeleteTemplate && existsSync(templatePath)) {
    await rm(templatePath);
  }

  await writeFile(path.join(outDir, '.nojekyll'), '');
  await writeFile(path.join(outDir, 'robots.txt'), generateRobotsTxt(siteBase, indexable));
  await writeFile(path.join(outDir, 'sitemap.xml'), generateSitemapXml(siteBase));

  console.log(`Public static site built into ${outDir}: en/ru; indexable=${indexable}; siteBase="${siteBase}"`);
  return { outDir, siteBase, indexable };
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await prerenderSite();
}
