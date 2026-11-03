import { hydrateRoot } from 'react-dom/client';
import { PreferencesProvider } from './preferences';
import { PublicApp } from './public-app';
import './styles.css';
const locale = document.documentElement.lang === 'ru' ? 'ru' : 'en';
hydrateRoot(document.getElementById('root')!, <PreferencesProvider locale={locale}><PublicApp /></PreferencesProvider>);
