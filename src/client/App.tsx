import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronLeft, ChevronRight, Cloud, Download, ExternalLink, File, FileSearch, FolderOpen, Gamepad2, HardDrive, Info, LoaderCircle, LogOut, Menu, Plus, QrCode, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { CloudFile, CloudGame, DeletePlan, DeleteResult, FileListing, SessionInfo } from '../shared/types';
import { api, ApiError, startDownload } from './api';
import { basename, bytes, date, gameColor, integer, parentPath } from './format';
import DeleteDialog from './DeleteDialog';

const BATCH_LIMIT = 500;
const PAGE_SIZE = 100;
type Notice = { kind: 'success' | 'error' | 'info'; message: string; details?: string[] };
type Sort = { key: 'name' | 'size' | 'modifiedAt'; direction: 'asc' | 'desc' };

function SortIndicator({ sort, column }: { sort: Sort; column: Sort['key'] }) {
  if (sort.key !== column) return null;
  return sort.direction === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />;
}

function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Cloud size={25} strokeWidth={2.1} /></span><div>Steam Cloud<span>MANAGER</span></div></div>;
}

function LoginScreen({ session, loading, error, onLogin, onRetry }: {
  session: SessionInfo | null; loading: boolean; error: string | null; onLogin: () => void; onRetry: () => void;
}) {
  const login = session?.login;
  const pending = login?.status === 'awaiting_confirmation' || login?.status === 'connecting';
  const demo = session?.mode === 'demo';
  return <div className="login-page">
    <header className="login-header"><Brand light /><span className="private-pill"><ShieldCheck size={15} /> Личный сервер</span></header>
    <main className="login-main">
      <section className="login-story">
        <div className="eyebrow"><span className="status-dot" /> ПОРЯДОК В ВАШЕМ ОБЛАКЕ</div>
        <h1>Меньше лишнего.<br /><span>Больше места<br className="desktop-break" /> для новых историй.</span></h1>
        <p className="login-description">Все облачные сохранения Steam в одном месте. Найдите старые файлы, скачайте нужные и освободите место для следующей игры.</p>
        <div className="login-features">
          <div><FileSearch size={21} /><span><strong>Посмотрите, что занимает место</strong><small>Сохранения по играм, размеру и дате</small></span></div>
          <div><Download size={21} /><span><strong>Оставьте копию у себя</strong><small>Отдельные файлы и ZIP с выбранными</small></span></div>
          <div><Trash2 size={21} /><span><strong>Удалите только ненужное</strong><small>Выборочная и массовая очистка</small></span></div>
        </div>
      </section>
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-card-icon"><Gamepad2 size={29} /></div>
        <h2 id="login-heading">Ваш Steam. Ваши сохранения.</h2>
        <p className="muted">{demo ? 'Посмотрите, как устроен менеджер, на демонстрационных данных.' : 'Подключите аккаунт через Steam Guard. Пароль вводить здесь не нужно.'}</p>
        {demo && <div className="demo-label"><Info size={16} /> Демо: реальные сохранения не затрагиваются</div>}
        {login?.qrDataUrl && pending ? <div className="qr-section">
          <div className="qr-frame"><img src={login.qrDataUrl} alt="QR-код для входа через приложение Steam" width="224" height="224" /></div>
          <div className="qr-status"><LoaderCircle className="spin" size={17} />{login.status === 'connecting' ? 'Подключаемся к Steam…' : 'Ожидаем подтверждения'}</div>
          <ol><li>Откройте приложение Steam на телефоне.</li><li>В Steam Guard отсканируйте QR-код.</li><li>Проверьте устройство и подтвердите вход.</li></ol>
        </div> : <div className="login-action">
          <div className="qr-illustration" aria-hidden="true"><QrCode size={68} strokeWidth={1.25} /><span><ShieldCheck size={20} /></span></div>
          <button className="button button-primary login-button" onClick={onLogin} disabled={loading || !session || pending}>
            {loading || pending ? <LoaderCircle className="spin" size={19} /> : <Gamepad2 size={20} />}
            {loading || pending ? 'Подключение…' : demo ? 'Открыть демо' : 'Войти через Steam'}<ArrowRight size={18} />
          </button>
        </div>}
        {(error || login?.error) && <div className="login-error" role="alert"><AlertCircle size={18} /><span>{error || login?.error}</span></div>}
        {login?.status === 'expired' && <p className="inline-error" role="status">QR-код истёк. Нажмите «Войти через Steam», чтобы получить новый.</p>}
        {!session && !loading && <button className="button button-secondary" onClick={onRetry}><RefreshCw size={16} /> Повторить подключение</button>}
        <div className="login-security"><ShieldCheck size={19} /><p>Это полная клиентская сессия Steam. Подключайтесь только к своему серверу или доверенной установке. Токены хранятся в памяти сервера до выхода или завершения сессии.</p></div>
      </section>
    </main>
    <footer className="login-footer"><span>Личный инструмент для Steam Cloud</span><span>Независимый проект · Не связан с Valve</span></footer>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [games, setGames] = useState<CloudGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [manualGame, setManualGame] = useState<CloudGame | null>(null);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'size', direction: 'desc' });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<'plan' | 'export' | 'delete' | null>(null);
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const connected = session?.login.status === 'connected';
  const pageCheckbox = useRef<HTMLInputElement>(null);
  const gamesRequest = useRef(0);
  const sessionRequest = useRef<Promise<void> | null>(null);

  const readSession = useCallback(() => {
    // StrictMode re-runs the mount effect in development. Share the request so
    // concurrent responses cannot pair one session's CSRF token with another cookie.
    if (sessionRequest.current) return sessionRequest.current;
    setSessionLoading(true); setSessionError(null);
    const pending = api<SessionInfo>('/api/session')
      .then(result => { setSession(result); })
      .catch(error => { setSessionError(error instanceof Error ? error.message : 'Сервер недоступен.'); })
      .finally(() => { sessionRequest.current = null; setSessionLoading(false); });
    sessionRequest.current = pending;
    return pending;
  }, []);
  useEffect(() => { void readSession(); }, [readSession]);
  useEffect(() => {
    if (!session || !['awaiting_confirmation', 'connecting'].includes(session.login.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api<SessionInfo>('/api/session', { signal: controller.signal });
        if (!cancelled) { setSession(result); setSessionError(null); }
      } catch (error) { if (!cancelled) setSessionError(error instanceof Error ? error.message : 'Соединение прервано.'); }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [session?.login.status]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { void readSession(); setPlan(null); }
    setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' });
  }, [readSession]);

  const loadGames = useCallback(async () => {
    const requestId = ++gamesRequest.current;
    setGamesLoading(true); setGamesError(null);
    try {
      const result = await api<{ games: CloudGame[] }>('/api/games');
      if (requestId !== gamesRequest.current) return;
      const sorted = [...result.games].sort((a, b) => b.totalBytes - a.totalBytes);
      setGames(sorted);
      setSelectedId(current => current ?? sorted[0]?.appId ?? null);
    } catch (error) { if (requestId === gamesRequest.current) { setGamesError(error instanceof Error ? error.message : 'Не удалось загрузить игры.'); if (error instanceof ApiError && error.status === 401) void readSession(); } }
    finally { if (requestId === gamesRequest.current) setGamesLoading(false); }
  }, [readSession]);
  useEffect(() => {
    if (connected) void loadGames();
    else { gamesRequest.current++; setGamesLoading(false); setGamesError(null); setGames([]); setListing(null); setSelectedId(null); setManualGame(null); setSelection(new Set()); setPlan(null); }
  }, [connected, loadGames]);

  useEffect(() => {
    if (!connected || selectedId === null) return;
    const controller = new AbortController();
    let current = true;
    setFilesLoading(true); setFilesError(null); setListing(null);
    api<FileListing>(`/api/games/${selectedId}/files`, { signal: controller.signal }).then(result => {
      if (!current) return;
      setListing(result); setUpdatedAt(new Date());
      const names = new Set(result.files.map(file => file.name));
      setSelection(existing => new Set([...existing].filter(name => names.has(name))));
    }).catch(error => {
      if (!current) return;
      setFilesError(error instanceof Error ? error.message : 'Не удалось загрузить файлы.');
      if (error instanceof ApiError && error.status === 401) void readSession();
    }).finally(() => { if (current) setFilesLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [connected, selectedId, refresh, readSession]);

  const selectGame = (id: number) => {
    if (action) return;
    setSelectedId(id); setQuery(''); setSelection(new Set()); setPage(0); setNotice(null); setSidebarOpen(false);
  };
  const activeGame = games.find(game => game.appId === selectedId) || (manualGame?.appId === selectedId ? manualGame : null);
  const sortedFiles = useMemo(() => {
    const found = (listing?.files || []).filter(file => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return found.sort((a, b) => {
      const compare = sort.key === 'name' ? a.name.localeCompare(b.name, 'ru') : a[sort.key] - b[sort.key];
      return (sort.direction === 'asc' ? compare : -compare) || a.name.localeCompare(b.name);
    });
  }, [listing, query, sort]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(sortedFiles.length / PAGE_SIZE) - 1));
  const pageFiles = sortedFiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectedFiles = useMemo(() => (listing?.files || []).filter(file => selection.has(file.name)), [listing, selection]);
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const allOnPage = pageFiles.length > 0 && pageFiles.every(file => selection.has(file.name));
  const someOnPage = pageFiles.some(file => selection.has(file.name));
  useEffect(() => { if (pageCheckbox.current) pageCheckbox.current.indeterminate = someOnPage && !allOnPage; }, [someOnPage, allOnPage]);
  const totalBytes = games.reduce((sum, game) => sum + game.totalBytes, 0);
  const totalFiles = games.reduce((sum, game) => sum + game.fileCount, 0);
  const currentBytes = listing?.files.reduce((sum, file) => sum + file.size, 0) ?? activeGame?.totalBytes ?? 0;
  const visibleGames = games.filter(game => `${game.name} ${game.appId}`.toLocaleLowerCase().includes(gameQuery.toLocaleLowerCase()));

  const startLogin = async () => {
    if (!session) return;
    setSessionLoading(true); setSessionError(null);
    try { setSession(await api<SessionInfo>('/api/auth/steam', { body: {}, csrf: session.csrfToken })); }
    catch (error) { setSessionError(error instanceof Error ? error.message : 'Не удалось начать вход.'); }
    finally { setSessionLoading(false); }
  };
  const logout = async () => {
    if (!session || action) return;
    gamesRequest.current++; setGamesLoading(false);
    setSessionLoading(true);
    try { setSession(await api<SessionInfo>('/api/auth/logout', { body: {}, csrf: session.csrfToken })); setNotice(null); }
    catch (error) { handleError(error); }
    finally { setSessionLoading(false); }
  };
  const toggleFile = (name: string) => {
    setSelection(existing => {
      const next = new Set(existing);
      if (next.has(name)) next.delete(name);
      else if (next.size < BATCH_LIMIT) next.add(name);
      return next;
    });
  };
  const togglePage = () => setSelection(existing => {
    const next = new Set(existing);
    for (const file of pageFiles) { if (allOnPage) next.delete(file.name); else if (next.size < BATCH_LIMIT) next.add(file.name); }
    return next;
  });
  const exportFiles = async (files = selectedFiles) => {
    if (!session || !listing || !files.length || action) return;
    setNotice(null); setAction('export');
    try {
      const result = await api<{ downloadUrl: string }>(`/api/games/${listing.appId}/exports`, { body: { names: files.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken });
      startDownload(result.downloadUrl);
      setNotice({ kind: 'info', message: 'Архив передан браузеру для скачивания. Дождитесь завершения загрузки перед удалением: большие сохранения потребуют времени.' });
    } catch (error) { handleError(error); }
    finally { setAction(null); }
  };
  const prepareDelete = async () => {
    if (!session || !listing || !selectedFiles.length || action) return;
    setNotice(null); setAction('plan');
    try {
      setPlan(await api<DeletePlan>(`/api/games/${listing.appId}/delete-plan`, { body: { names: selectedFiles.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken }));
    } catch (error) { handleError(error); }
    finally { setAction(null); }
  };
  const deleteFiles = async (confirmation: string) => {
    if (!session || !plan || action) return;
    setAction('delete');
    try {
      const result = await api<DeleteResult>(`/api/games/${plan.appId}/delete`, { body: { planId: plan.planId, confirmation, gamesClosed: true }, csrf: session.csrfToken });
      setPlan(null); setSelection(new Set());
      setNotice({
        kind: result.failed.length || !result.batchCompleted ? 'error' : 'success',
        message: result.failed.length || !result.batchCompleted
          ? `Удалено: ${result.deleted.length}. Ошибок: ${result.failed.length}.${!result.batchCompleted ? ' Steam не подтвердил завершение операции. Обновите список перед следующим действием.' : ' Проверьте оставшиеся файлы.'}`
          : `Удалено ${result.deleted.length} файлов из Steam Cloud. Список сохранений обновлён.`,
        details: result.failed.map(file => `${file.name}: ${file.message}`),
      });
      setRefresh(value => value + 1); void loadGames();
    } catch (error) { handleError(error); setPlan(null); setRefresh(value => value + 1); }
    finally { setAction(null); }
  };
  const changeSort = (key: Sort['key']) => { setSort(current => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' })); setPage(0); };

  if (!connected) return <LoginScreen session={session} loading={sessionLoading} error={sessionError} onLogin={() => void startLogin()} onRetry={() => void readSession()} />;

  return <div className="app-layout"><a className="skip-link" href="#main-content">Перейти к сохранениям</a>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню игр" />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Игры Steam Cloud">
      <div className="sidebar-brand"><Brand light /><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню"><X size={19} /></button></div>
      <div className="sidebar-section-label">БИБЛИОТЕКА <span>{games.length}</span></div>
      <label className="game-search"><Search size={16} /><input aria-label="Поиск игры" placeholder="Найти игру…" value={gameQuery} onChange={event => setGameQuery(event.target.value)} /></label>
      <nav className="game-list" aria-label="Выберите игру">
        {gamesLoading && !games.length ? Array.from({ length: 4 }, (_, index) => <div className="game-skeleton skeleton" key={index} />) : visibleGames.map(game => <button className={`game-button ${selectedId === game.appId ? 'active' : ''}`} key={game.appId} onClick={() => selectGame(game.appId)} disabled={!!action} aria-current={selectedId === game.appId ? 'page' : undefined}>
          <span className={`game-icon ${gameColor(game.appId)}`}><Gamepad2 size={20} /></span><span className="game-name"><strong>{game.name}</strong><small>{bytes(game.totalBytes)} <span>· {integer(game.fileCount)} файлов</span></small></span>{selectedId === game.appId && <span className="active-dot" />}
        </button>)}
        {!gamesLoading && !visibleGames.length && <p className="sidebar-empty">{gameQuery ? 'Игры не найдены' : 'Игр с облачными файлами пока нет'}</p>}
        {manualGame && !games.some(game => game.appId === manualGame.appId) && <button className={`game-button ${selectedId === manualGame.appId ? 'active' : ''}`} onClick={() => selectGame(manualGame.appId)}><span className="game-icon blue"><Gamepad2 size={20} /></span><span className="game-name"><strong>{manualGame.name}</strong><small>Добавлено по AppID</small></span></button>}
      </nav>
      {gamesError && <div className="sidebar-error"><p>{gamesError}</p><button onClick={() => void loadGames()} disabled={gamesLoading}><RefreshCw size={14} /> Повторить</button></div>}
      <form className="add-game" onSubmit={event => {
        event.preventDefault(); const id = Number(manualInput);
        if (!Number.isInteger(id) || id < 1 || id > 4294967295) return;
        setManualGame({ appId: id, name: `Steam App ${id}`, fileCount: 0, totalBytes: 0 }); selectGame(id); setManualInput('');
      }}><label htmlFor="app-id">Открыть игру по AppID</label><div><input id="app-id" aria-label="AppID игры" placeholder="Например, 949230" inputMode="numeric" pattern="[0-9]+" value={manualInput} onChange={event => setManualInput(event.target.value)} disabled={!!action} /><button aria-label="Открыть игру по AppID" disabled={!manualInput || !!action}><Plus size={17} /></button></div></form>
      <div className="sidebar-bottom"><div className="storage-mini"><Cloud size={19} /><div><strong>{bytes(totalBytes)}</strong><span>в облаке Steam</span></div></div><p>Объём файлов в обнаруженных играх.<br />Лимит хранилища задаётся для каждой игры.</p></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Открыть меню игр"><Menu size={21} /></button><span className="breadcrumb"><Cloud size={16} /> Моё облако <ChevronRight size={14} /><strong>Сохранения</strong></span></div><div className="account"><span className="connection-status"><span className="status-dot" /> Steam подключён</span><span className="account-avatar">{session.login.user?.displayName?.slice(0, 1).toLocaleUpperCase() || 'S'}</span><span className="account-name">{session.login.user?.displayName || 'Steam'}</span><button className="icon-button" onClick={() => void logout()} disabled={!!action || sessionLoading} aria-label="Выйти из Steam" title="Выйти и завершить Steam-сессию"><LogOut size={18} /></button></div></header>

      <main className="main-content" id="main-content">
        {session.mode === 'demo' && <div className="demo-banner"><Info size={17} /><span><strong>Демонстрационный режим.</strong> Все файлы вымышленные. Действия не меняют Steam Cloud.</span></div>}
        <div className="page-heading"><div><div className="eyebrow dark-eyebrow">ВАШЕ ОБЛАКО, БЕЗ ЛИШНЕГО</div><h1>Мои сохранения</h1><p>Найдите нужное. Сохраните важное. Освободите место.</p></div><button className="button button-secondary refresh-button" onClick={() => { void loadGames(); setRefresh(value => value + 1); }} disabled={gamesLoading || filesLoading || !!action}><RefreshCw size={16} className={gamesLoading || filesLoading ? 'spin' : ''} /> Обновить</button></div>
        <section className="stats-grid" aria-label="Обзор облачного хранилища">
          <div className="stat-card"><span className="stat-icon blue"><HardDrive size={22} /></span><div><span className="stat-label">Всего в облаке</span><strong>{gamesLoading && !games.length ? '…' : bytes(totalBytes)}</strong><small>В обнаруженных играх</small></div><span className="stat-decoration" aria-hidden="true" /></div>
          <div className="stat-card"><span className="stat-icon violet"><File size={22} /></span><div><span className="stat-label">Облачные файлы</span><strong>{gamesLoading && !games.length ? '…' : integer(totalFiles)}</strong><small>Сохранения и настройки</small></div></div>
          <div className="stat-card"><span className="stat-icon green"><Gamepad2 size={23} /></span><div><span className="stat-label">Игры с сохранениями</span><strong>{gamesLoading && !games.length ? '…' : integer(games.length)}</strong><small>В вашем аккаунте Steam</small></div></div>
        </section>

        {notice && <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.kind === 'success' ? <CheckCircle2 size={20} /> : notice.kind === 'error' ? <AlertCircle size={20} /> : <Info size={20} />}</span><div>{notice.message}{!!notice.details?.length && <details><summary>Подробности ({notice.details.length})</summary><ul>{notice.details.map((detail, i) => <li key={i}>{detail}</li>)}</ul></details>}</div><button className="icon-button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление"><X size={17} /></button></div>}

        <section className="files-panel" aria-labelledby="game-heading">
          <div className="game-heading"><div className={`game-cover ${gameColor(selectedId || 0)}`}><Gamepad2 size={32} strokeWidth={1.5} /></div><div className="game-title"><div className="section-kicker">ОБЛАЧНЫЕ СОХРАНЕНИЯ</div><h2 id="game-heading">{activeGame?.name || (gamesLoading ? 'Загружаем библиотеку…' : 'Выберите игру')}</h2>{selectedId && <div className="game-meta"><span>AppID {selectedId}</span><span>·</span><span>{listing ? integer(listing.files.length) : '—'} файлов</span><span>·</span><span>{bytes(currentBytes)}</span></div>}</div>{selectedId && <a className="steam-link" href={`https://store.steampowered.com/app/${selectedId}/`} target="_blank" rel="noreferrer" title="Открыть игру в Steam" aria-label="Открыть игру в Steam"><ExternalLink size={17} /></a>}</div>

          <div className="file-toolbar"><label className="file-search"><Search size={18} /><input aria-label="Поиск сохранений" placeholder="Поиск по названию или пути файла" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} disabled={!listing} />{query && <button onClick={() => { setQuery(''); setPage(0); }} aria-label="Очистить поиск"><X size={15} /></button>}</label><label className="sort-select"><span>Порядок</span><select aria-label="Сортировка файлов" value={`${sort.key}:${sort.direction}`} onChange={event => { const [key, direction] = event.target.value.split(':') as [Sort['key'], Sort['direction']]; setSort({ key, direction }); setPage(0); }}><option value="size:desc">Сначала большие</option><option value="size:asc">Сначала маленькие</option><option value="modifiedAt:desc">Сначала новые</option><option value="modifiedAt:asc">Сначала старые</option><option value="name:asc">По имени А → Я</option></select></label></div>
          {listing && listing.files.length > 0 && <div className="selection-toolbar"><span>{query ? `Найдено: ${integer(sortedFiles.length)}` : `${integer(listing.files.length)} файлов`}<span className="selection-count">{selection.size ? ` · Выбрано: ${selection.size}` : ''}</span></span><div><button className="text-button" onClick={() => setSelection(new Set(sortedFiles.slice(0, BATCH_LIMIT).map(file => file.name)))} disabled={!sortedFiles.length || !!action}>{sortedFiles.length > BATCH_LIMIT ? `Выбрать первые ${BATCH_LIMIT}` : 'Выбрать все найденные'}</button>{selection.size > 0 && <button className="text-button muted" onClick={() => setSelection(new Set())} disabled={!!action}>Снять выбор</button>}</div></div>}

          {filesLoading ? <div className="files-loading" aria-label="Загружаем сохранения" role="status">{Array.from({ length: 6 }, (_, i) => <div className="file-skeleton" key={i}><span className="skeleton" /><div><span className="skeleton" /><small className="skeleton" /></div><span className="skeleton" /></div>)}</div> : filesError ? <div className="empty-state"><span className="empty-icon error"><AlertCircle size={31} /></span><h3>Не удалось прочитать сохранения</h3><p>{filesError}</p><button className="button button-secondary" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /> Попробовать снова</button></div> : !listing ? <div className="empty-state"><span className="empty-icon"><Cloud size={34} /></span><h3>{gamesLoading ? 'Загружаем игры из Steam' : 'Начнём с игры'}</h3><p>{gamesLoading ? 'Большая библиотека может загружаться немного дольше.' : 'Выберите игру слева или укажите её AppID, чтобы посмотреть облачные файлы.'}</p></div> : !sortedFiles.length ? <div className="empty-state"><span className="empty-icon"><FolderOpen size={33} /></span><h3>{query ? 'Ничего не нашлось' : 'Облако этой игры пусто'}</h3><p>{query ? 'Попробуйте другое имя, расширение или часть пути.' : 'В Steam Cloud этой игры сейчас нет сохранений.'}</p>{query && <button className="button button-secondary" onClick={() => setQuery('')}>Сбросить поиск</button>}</div> : <div className="file-table-scroll"><table className="file-table"><thead><tr><th className="checkbox-cell"><input ref={pageCheckbox} type="checkbox" aria-label="Выбрать файлы на текущей странице" checked={allOnPage} onChange={togglePage} disabled={!!action || (selection.size >= BATCH_LIMIT && !someOnPage)} /></th><th className="name-column"><button onClick={() => changeSort('name')}>ИМЯ ФАЙЛА <SortIndicator sort={sort} column="name" /></button></th><th className="size-column"><button onClick={() => changeSort('size')}>РАЗМЕР <SortIndicator sort={sort} column="size" /></button></th><th className="date-column"><button onClick={() => changeSort('modifiedAt')}>ИЗМЕНЁН <SortIndicator sort={sort} column="modifiedAt" /></button></th><th className="file-actions-column"><span className="sr-only">Действия</span></th></tr></thead><tbody>{pageFiles.map((file: CloudFile) => <tr key={file.name} className={selection.has(file.name) ? 'row-selected' : ''}><td className="checkbox-cell"><input type="checkbox" aria-label={`Выбрать ${file.name}`} checked={selection.has(file.name)} onChange={() => toggleFile(file.name)} disabled={!!action || (!selection.has(file.name) && selection.size >= BATCH_LIMIT)} /></td><td><div className="filename"><span className={`file-type-icon ${/\.(png|jpg|jpeg|webp)$/i.test(file.name) ? 'image-file' : ''}`}><File size={20} strokeWidth={1.5} /></span><div><strong title={basename(file.name)}>{basename(file.name)}</strong>{parentPath(file.name) && <small title={file.name}>{parentPath(file.name)}</small>}<span className="mobile-file-meta">{bytes(file.size)} · {date(file.modifiedAt)}</span></div></div></td><td className="size-cell">{bytes(file.size)}</td><td className="date-cell">{date(file.modifiedAt)}</td><td className="file-actions-column"><button className="icon-button file-download" title={`Скачать ${basename(file.name)}`} aria-label={`Скачать ${file.name}`} disabled={!!action} onClick={() => { try { startDownload(`/api/games/${listing.appId}/download?name=${encodeURIComponent(file.name)}`); } catch (error) { handleError(error); } }}><Download size={17} /></button></td></tr>)}</tbody></table></div>}

          {listing && sortedFiles.length > 0 && <div className="table-footer"><span>{integer(safePage * PAGE_SIZE + 1)}–{integer(Math.min((safePage + 1) * PAGE_SIZE, sortedFiles.length))} из {integer(sortedFiles.length)} файлов</span><div className="pagination"><button className="icon-button" disabled={safePage === 0} onClick={() => setPage(value => value - 1)} aria-label="Предыдущая страница"><ChevronLeft size={18} /></button><span>{safePage + 1} / {Math.ceil(sortedFiles.length / PAGE_SIZE)}</span><button className="icon-button" disabled={(safePage + 1) * PAGE_SIZE >= sortedFiles.length} onClick={() => setPage(value => value + 1)} aria-label="Следующая страница"><ChevronRight size={18} /></button></div></div>}
        </section>

        {selectedFiles.length > 0 ? <div className="bulk-actions"><div className="bulk-summary"><span className="selection-check"><Check size={19} /></span><div><strong>Выбрано {selectedFiles.length} файлов</strong><small>{bytes(selectedBytes)}{selection.size > sortedFiles.filter(file => selection.has(file.name)).length ? ' · включая файлы вне фильтра' : ''}</small></div></div><div className="bulk-buttons"><button className="button button-secondary" onClick={() => void exportFiles()} disabled={!!action || filesLoading}>{action === 'export' ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />} Скачать ZIP</button><button className="button button-danger" onClick={() => void prepareDelete()} disabled={!!action || filesLoading}>{action === 'plan' ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />} Удалить выбранные</button></div></div> : <div className="selection-hint"><Info size={16} /><span>Выберите файлы, чтобы скачать резервную копию или удалить их из облака.{(listing?.files.length || 0) > BATCH_LIMIT ? ` За один раз — до ${BATCH_LIMIT} файлов.` : ''}</span></div>}
        <div className="sync-note"><ShieldCheck size={18} /><p>Перед удалением закройте игру и GeForce NOW на всех устройствах. Активная синхронизация может загрузить сохранения обратно.</p></div>
        <footer className="workspace-footer"><span>Независимый проект · Не связан с Valve</span>{updatedAt && <span><span className="status-dot" /> Обновлено {updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}</footer>
      </main>
    </div>
    {plan && <DeleteDialog plan={plan} error={notice?.kind === 'error' ? notice.message : undefined} deleting={action === 'delete'} exporting={action === 'export'} onClose={() => { if (!action) setPlan(null); }} onDelete={value => void deleteFiles(value)} onBackup={() => void exportFiles(plan.files)} />}
  </div>;
}
