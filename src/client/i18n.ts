export type Locale = 'en' | 'ru';
export const en = {
  title: 'Steam Cloud Manager', description: 'View, back up and delete Steam Cloud saves on your computer.',
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
  sessionLocal: 'The Steam session stays on this computer.',
  localOnly: 'Steam sign-in runs in the local app, not on this website.',
  install: 'Run locally', source: 'Source code', launchLocal: 'Open local app', requirements: 'Requires Node.js 22.12+ and a computer running Windows, macOS or Linux.',
  installSteps: 'Install and start', installHelp: 'Run these commands in a terminal, then open the local app.',
  securityTitle: 'Where your data goes',
  securityLocal: 'Steam tokens stay in the memory of the local process on your computer. The local app talks directly to Steam. Tokens are not written to browser storage, a database or application logs.',
  securityPublic: 'Vercel serves only this public website. It has no Steam sign-in, session or file API. It does not receive your Steam tokens, QR challenge or saves. Hosting providers may still log ordinary website requests, such as your IP address.',
  securityStorage: 'The browser stores only language, theme and favorite game IDs per account. Cloud file lists stay in memory. There is no analytics or advertising code.',
  securityLimits: 'This is not a security audit or a guarantee. The local process holds a full Steam client session. Malicious software, browser extensions or a modified build can compromise it. Inspect the source and dependencies; disconnect after use.',
  securityControls: 'The backend binds only to loopback addresses. Changes require same-origin requests and CSRF protection. Deletion requires an explicit selection and a fresh server-side check.',
  architecture: 'Why a local app?',
  architectureText: 'Steam does not provide a general browser-only Cloud integration for arbitrary games. The tested Steam endpoints reject our website origin. A local app avoids sending a Steam session through a hosted proxy.',
  favoriteHint: 'Favorites are stored only in this browser.',
  statusHint: 'Cloud status is checked in small batches. “Not checked” and a failed check do not mean the cloud is empty.',
  previous: 'Previous page', next: 'Next page', clearSearch: 'Clear search', filePath: 'Full path',
  limitHint: 'Up to 500 files per operation.', localLabel: 'Local app', publicTitle: 'Steam Cloud save manager',
  featureBrowse: 'Browse saves by game', featureBackup: 'Download files and ZIP backups', featureDelete: 'Delete selected saves with confirmation',
};
export type Messages = { [K in keyof typeof en]: string };
export const ru: Messages = {
  title: 'Steam Cloud Manager', description: 'Просмотр, резервное копирование и удаление сохранений Steam Cloud на вашем компьютере.',
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
  sessionLocal: 'Сессия Steam остаётся на этом компьютере.',
  localOnly: 'Вход в Steam выполняется в локальном приложении, а не на этом сайте.',
  install: 'Запустить локально', source: 'Исходный код', launchLocal: 'Открыть локальное приложение', requirements: 'Нужны Node.js 22.12+ и компьютер с Windows, macOS или Linux.',
  installSteps: 'Установка и запуск', installHelp: 'Выполните команды в терминале, затем откройте локальное приложение.',
  securityTitle: 'Куда передаются данные',
  securityLocal: 'Токены Steam остаются в памяти локального процесса на вашем компьютере. Приложение обращается прямо к Steam. Токены не записываются в хранилище браузера, базу данных или журналы приложения.',
  securityPublic: 'Vercel раздаёт только публичный сайт. На нём нет API входа в Steam, сессий или файлов. Он не получает токены Steam, QR-запросы или сохранения. Хостинг при этом может вести обычные журналы посещений, например с IP-адресом.',
  securityStorage: 'Браузер хранит только язык, тему и ID избранных игр отдельно для каждого аккаунта. Списки файлов остаются в памяти. Аналитики и рекламного кода нет.',
  securityLimits: 'Это не аудит безопасности и не гарантия. Локальный процесс получает полную клиентскую сессию Steam. Вредоносное ПО, расширения браузера или изменённая сборка могут её скомпрометировать. Проверяйте код и зависимости; завершайте сессию после работы.',
  securityControls: 'Сервер слушает только loopback-адрес. Изменения требуют запроса с того же origin и CSRF-защиты. Перед удалением проверяются выбранные файлы и их актуальность.',
  architecture: 'Почему локальное приложение?',
  architectureText: 'Steam не предоставляет универсальную браузерную интеграцию с Cloud для любых игр. Проверенные адреса Steam отклоняют origin нашего сайта. Локальный запуск позволяет обойтись без передачи Steam-сессии через хостинг-прокси.',
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
