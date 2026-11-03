export type Locale = 'en' | 'ru';
export const en = {
  title: 'Steam Cloud Manager', description: 'View, download and delete Steam Cloud saves in your browser.',
  signIn: 'Sign in with Steam', signOut: 'Sign out', library: 'Games', back: 'All games',
  searchGames: 'Search games', searchFiles: 'Search files', noGames: 'No games found', noFiles: 'No files found',
  emptyLibrary: 'No games are available. You can open a game by its Steam link or AppID.',
  loading: 'Loading…', loadMore: 'Load more games', loadingGames: 'Loading games', loadingFiles: 'Loading saves',
  retry: 'Try again', refresh: 'Refresh', openManual: 'Open by Steam link or AppID',
  manualHint: 'Steam store URL or numeric AppID', manualInvalid: 'Enter an AppID or an HTTPS Steam store /app/ URL.',
  open: 'Open', game: 'Game', files: 'Files', name: 'File name', size: 'Size', modified: 'Modified',
  sort: 'Sort files', sortSize: 'Largest first', sortNewest: 'Newest first', sortOldest: 'Oldest first', sortName: 'By name',
  selectAll: 'Select matching files', selectPage: 'Select files on this page', clearSelection: 'Clear selection',
  download: 'Download', zip: 'Download ZIP', remove: 'Delete', selected: 'selected',
  noSaves: 'No cloud saves', unsupported: 'Steam Cloud not supported', unknownCloud: 'Not checked',
  checking: 'Checking cloud saves…', checkFailed: 'Could not check cloud saves',
  favoriteAdd: 'Add to favorites', favoriteRemove: 'Remove from favorites',
  language: 'Language', theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark',
  security: 'Security', close: 'Close', cancel: 'Cancel', details: 'Details',
  deleteTitle: 'Delete cloud saves?', deleteWarning: 'Deletion cannot be undone here. Download and verify a backup first.',
  gamesClosed: 'I have closed the game and GeForce NOW on all devices.',
  typePhrase: 'Type the confirmation exactly:', confirmDelete: 'Delete permanently',
  expiredPlan: 'This confirmation expired. Close this window and select the files again.',
  backupNotice: 'Wait for the download to finish and check the archive before deleting.',
  backupDone: 'The backup was saved. Check the file before deleting the cloud copy.',
  backupReady: 'The download link is ready. Click it to save the archive. It is single-use and expires in five minutes.',
  downloadPrepared: 'Save prepared ZIP', downloading: 'Saving backup…',
  deleteDone: 'Deleted files:', deletePartial: 'Some deletions could not be confirmed. Check the refreshed file list.',
  demo: 'Demo — no Steam account or real files', demoButton: 'Open demo',
  qrInstructions: 'Scan the code in Steam Guard and confirm the sign-in.',
  connecting: 'Connecting to Steam…', waiting: 'Waiting for Steam Guard',
  expiredLogin: 'The QR code expired. Start sign-in again.', loginFailed: 'Steam could not connect. Try signing in again.',
  requestFailed: 'The request failed. Try again.', sessionExpired: 'The session ended. Sign in again.',
  filesChanged: 'The files changed. Refresh the list and select them again.', rateLimited: 'Steam is busy. Try again later.',
  downloadFailed: 'The backup could not be downloaded. Do not delete the original files.',
  libraryNotReady: 'Steam is still loading the library. Try refreshing shortly.',
  sessionLocal: 'Your encrypted Steam session is stored in a Secure HttpOnly cookie and decrypted on Vercel.',
  localOnly: 'Steam sign-in and Cloud operations run through Vercel Functions, not a local app.',
  install: 'Open web app', source: 'Source code', launchLocal: 'Open Steam Cloud Manager', requirements: 'No installation required. Works in modern browsers.',
  installSteps: 'Start using the service', installHelp: 'Open the app, scan the Steam Guard QR code and select a game.',
  securityTitle: 'Where your data goes',
  securityLocal: 'The full Steam refresh token is encrypted in a short-lived HttpOnly cookie. Vercel Functions decrypt it to connect to Steam. Vercel and anyone holding the encryption key can technically access your session.',
  securityPublic: 'Both the website and Steam API run on Vercel under this domain. Steam data and backup streams pass through Vercel Functions. No separate VPS or local process is required.',
  securityStorage: 'The browser stores the encrypted session cookie and local language, theme and favorite AppIDs. Cloud files are requested as needed. The code does not intentionally log Steam tokens.',
  securityLimits: 'Open source is not an independent security audit. This service receives a full Steam client session, not a Cloud-only OAuth grant. A compromised deployment, key or hosting provider could access it. Sign in only if you trust this deployment.',
  securityControls: 'Requests use same-origin Secure HttpOnly SameSite cookies, AES-GCM and CSRF protection. Files are checked before download and deletion. Deletion is disabled until cross-function replay protection is verified.',
  architecture: 'How does it work?',
  architectureText: 'Vercel Functions handle the Steam Guard login and reconnect to Steam on each request using a short-lived encrypted cookie. A multi-gigabyte ZIP can exceed function execution limits.',
  favoriteHint: 'Favorites are stored only in this browser.',
  statusHint: 'Cloud status is checked in small batches. “Not checked” and a failed check do not mean the cloud is empty.',
  previous: 'Previous page', next: 'Next page', clearSearch: 'Clear search', filePath: 'Full path',
  limitHint: 'Up to 500 files per operation.', localLabel: 'Local app', publicTitle: 'Steam Cloud save manager',
  featureBrowse: 'Browse saves by game', featureBackup: 'Download files and ZIP backups', featureDelete: 'Delete selected saves with confirmation',
};
export type Messages = { [K in keyof typeof en]: string };
export const ru: Messages = {
  title: 'Steam Cloud Manager', description: 'Просмотр, скачивание и удаление сохранений Steam Cloud прямо в браузере.',
  signIn: 'Войти через Steam', signOut: 'Выйти', library: 'Игры', back: 'Все игры',
  searchGames: 'Найти игру', searchFiles: 'Найти файл', noGames: 'Игры не найдены', noFiles: 'Файлы не найдены',
  emptyLibrary: 'Нет доступных игр. Игру можно открыть по ссылке Steam или AppID.',
  loading: 'Загрузка…', loadMore: 'Показать ещё игры', loadingGames: 'Загружаем игры', loadingFiles: 'Загружаем сохранения',
  retry: 'Повторить', refresh: 'Обновить', openManual: 'Открыть по ссылке Steam или AppID',
  manualHint: 'Ссылка на игру в Steam или числовой AppID', manualInvalid: 'Введите AppID или HTTPS-ссылку /app/ из магазина Steam.',
  open: 'Открыть', game: 'Игра', files: 'Файлы', name: 'Имя файла', size: 'Размер', modified: 'Изменён',
  sort: 'Сортировка файлов', sortSize: 'Сначала большие', sortNewest: 'Сначала новые', sortOldest: 'Сначала старые', sortName: 'По имени',
  selectAll: 'Выбрать найденные файлы', selectPage: 'Выбрать файлы на странице', clearSelection: 'Снять выбор',
  download: 'Скачать', zip: 'Скачать ZIP', remove: 'Удалить', selected: 'выбрано',
  noSaves: 'Нет облачных сохранений', unsupported: 'Steam Cloud не поддерживается', unknownCloud: 'Ещё не проверено',
  checking: 'Проверяем облачные сохранения…', checkFailed: 'Не удалось проверить облако',
  favoriteAdd: 'Добавить в избранное', favoriteRemove: 'Убрать из избранного',
  language: 'Язык', theme: 'Тема', system: 'Системная', light: 'Светлая', dark: 'Тёмная',
  security: 'Безопасность', close: 'Закрыть', cancel: 'Отмена', details: 'Подробности',
  deleteTitle: 'Удалить облачные сохранения?', deleteWarning: 'Отменить удаление здесь нельзя. Сначала скачайте и проверьте резервную копию.',
  gamesClosed: 'Я закрыл игру и GeForce NOW на всех устройствах.',
  typePhrase: 'Введите фразу подтверждения точно:', confirmDelete: 'Удалить навсегда',
  expiredPlan: 'Подтверждение устарело. Закройте окно и выберите файлы заново.',
  backupNotice: 'Дождитесь окончания скачивания и проверьте архив перед удалением.',
  backupDone: 'Резервная копия сохранена. Проверьте файл перед удалением из облака.',
  backupReady: 'Ссылка готова. Нажмите на неё, чтобы скачать архив. Она одноразовая и действует пять минут.',
  downloadPrepared: 'Скачать подготовленный ZIP', downloading: 'Сохраняем резервную копию…',
  deleteDone: 'Удалено файлов:', deletePartial: 'Часть удалений не подтверждена. Проверьте обновлённый список.',
  demo: 'Демо — без аккаунта Steam и настоящих файлов', demoButton: 'Открыть демо',
  qrInstructions: 'Отсканируйте код в Steam Guard и подтвердите вход.',
  connecting: 'Подключаемся к Steam…', waiting: 'Ожидаем подтверждения Steam Guard',
  expiredLogin: 'QR-код истёк. Начните вход заново.', loginFailed: 'Не удалось подключиться к Steam. Повторите вход.',
  requestFailed: 'Запрос не выполнен. Попробуйте ещё раз.', sessionExpired: 'Сессия завершена. Войдите заново.',
  filesChanged: 'Файлы изменились. Обновите список и выберите их заново.', rateLimited: 'Steam занят. Попробуйте позже.',
  downloadFailed: 'Не удалось скачать резервную копию. Не удаляйте исходные файлы.',
  libraryNotReady: 'Steam ещё загружает библиотеку. Повторите обновление чуть позже.',
  sessionLocal: 'Зашифрованная Steam-сессия хранится в Secure HttpOnly cookie и расшифровывается на Vercel.',
  localOnly: 'Авторизация Steam и работа с Cloud выполняются на Vercel Functions без локальных программ.',
  install: 'Открыть приложение', source: 'Исходный код', launchLocal: 'Открыть Steam Cloud Manager', requirements: 'Ничего устанавливать не нужно. Достаточно современного браузера.',
  installSteps: 'Начать работу', installHelp: 'Откройте приложение, подтвердите QR в Steam Guard и выберите игру.',
  securityTitle: 'Куда передаются данные',
  securityLocal: 'Полный refresh token Steam зашифрован в краткоживущей HttpOnly cookie. Vercel Functions расшифровывают его для подключения к Steam. Vercel и обладатель ключа шифрования технически могут получить доступ к сессии.',
  securityPublic: 'И сайт, и Steam API работают только на Vercel под одним доменом. Данные сохранений и загрузки проходят через Vercel Functions. Другой VPS или локальная программа не нужны.',
  securityStorage: 'В браузере хранятся зашифрованная cookie, язык, тема и ID избранных игр. Файлы запрашиваются по необходимости. Код не записывает токены Steam в журналы намеренно.',
  securityLimits: 'Открытый исходный код не заменяет независимый аудит. Сервис получает полную клиентскую Steam-сессию, а не ограниченный Cloud OAuth. Взломанное развёртывание, ключ или хостинг могут её раскрыть. Входите только на доверенном сайте.',
  securityControls: 'Запросы защищены same-origin Secure HttpOnly SameSite cookie, AES-GCM и CSRF. Перед скачиванием и удалением файлы перепроверяются. Удаление отключено до проверки защиты от повторных запросов между Functions.',
  architecture: 'Как это работает?',
  architectureText: 'Vercel Functions проводят авторизацию Steam Guard и подключаются к Steam заново при каждом запросе через краткоживущую зашифрованную cookie. ZIP на несколько гигабайт может превысить лимит времени Function.',
  favoriteHint: 'Избранное хранится только в этом браузере.',
  statusHint: 'Облако проверяется небольшими порциями. «Ещё не проверено» и ошибка проверки не означают, что сохранений нет.',
  previous: 'Предыдущая страница', next: 'Следующая страница', clearSearch: 'Очистить поиск', filePath: 'Полный путь',
  limitHint: 'За одну операцию — до 500 файлов.', localLabel: 'Локальное приложение', publicTitle: 'Менеджер сохранений Steam Cloud',
  featureBrowse: 'Просмотр сохранений по играм', featureBackup: 'Скачивание файлов и ZIP-копий', featureDelete: 'Удаление выбранных сохранений с подтверждением',
};
export const messages = { en, ru };
export function formatBytes(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = locale === 'ru' ? ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = value === 0 ? 0 : Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(value / 1024 ** i)} ${units[i]}`;
}
export function countFiles(count: number, locale: Locale): string {
  if (locale === 'en') return `${count.toLocaleString('en')} ${count === 1 ? 'file' : 'files'}`;
  const category = new Intl.PluralRules('ru').select(count);
  return `${count.toLocaleString('ru')} ${category === 'one' ? 'файл' : category === 'few' ? 'файла' : 'файлов'}`;
}
export function errorText(error: unknown, locale: Locale): string {
  const t = messages[locale];
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const text = /DOWNLOAD|STORAGE|EXPORT/.test(code) ? t.downloadFailed
    : /CHANGED|MISSING|PLAN_EXPIRED/.test(code) ? t.filesChanged
    : /SESSION|NOT_CONNECTED|STEAM_REQUIRED|RESULT_5$/.test(code) ? t.sessionExpired
    : /RATE|BUSY|RESULT_84$/.test(code) ? t.rateLimited
    : code === 'LIBRARY_NOT_READY' ? t.libraryNotReady : t.requestFailed;
  return code ? `${text} (${code})` : text;
}
