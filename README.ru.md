# Steam Cloud Manager

[English](README.md) · [Безопасность](SECURITY.md)

Open-source веб-сервис для просмотра, скачивания и удаления файлов Steam Cloud. Пользователю не нужны локальный Node.js, Electron, VPS или установка программ.

**Статус:** Vercel-only реализация в черновом PR. Демо-тесты проходят, но реальный вход через Steam Guard и повторное подключение к Steam на Vercel ещё не подтверждены. Удаление по умолчанию отключено до защиты от повторного одновременного запроса.

## Архитектура: только Vercel

- /en/ и /ru/: SEO-страницы.
- /app/: интерфейс React с русским/английским языками, избранным, ленивой подгрузкой, тремя режимами темы.
- /api/*: Vercel Node.js Functions на том же домене.
- QR-вход обрабатывается одной потоковой Function. Сессия шифруется AES-256-GCM и хранится в краткоживущей Secure HttpOnly SameSite=Strict cookie браузера.
- При каждом API-запросе Vercel Function расшифровывает токен, подключается к Steam, выполняет запрос и закрывает соединение.

**Безопасность:** сервер Vercel имеет доступ к расшифрованному токену Steam. Оператор и злоумышленник с доступом к ключу или серверу могут получить полную Steam-сессию. Открытая репа помогает проверить реализацию, но не гарантирует безопасность развёртывания. Независимого аудита нет.

## Развёртывание

Создайте проект на Vercel из репозитория. Конфигурация — [vercel.json](vercel.json), без внешних серверов.

Нужна секретная переменная SCM_SESSION_KEY (32 случайных байта, base64url, 43 символа). Создать её можно через Node crypto.randomBytes(32).toString('base64url'); значение сохранить только в Vercel Environment Variables. SITE_URL задаёт SEO-домен. DEMO_MODE=true допустим лишь на preview. ENABLE_CLOUD_DELETE оставить пустым/false в production.

Большие ZIP могут превышать 300-секундный лимит Function. Резервную копию нужно открыть и проверить до удаления исходных сохранений.

Для локальной разработки (не для пользователей):

    npm ci
    npm run dev
    npm run check
    npm run test:browser:install
    npm run test:e2e

Подробная архитектура — [docs/vercel-only-architecture.md](docs/vercel-only-architecture.md), модель угроз — [SECURITY.md](SECURITY.md).

made by [@famence](https://github.com/famence)
