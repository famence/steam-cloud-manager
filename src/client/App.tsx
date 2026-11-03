import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Cloud, Download, File, Gamepad2, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { CloudGame, DeletePlan, DeleteResult, FileListing, SessionInfo } from '../shared/types';
import { api, ApiError, startDownload } from './api';
import { basename, bytes, date, integer } from './format';
import DeleteDialog from './DeleteDialog';
import { parseAppId, fileCountLabel } from './library';

const BATCH_LIMIT = 500;
const PAGE_SIZE = 100;
const GAME_PAGE_SIZE = 24;
type Notice = { kind: 'success' | 'error' | 'info'; message: string; details?: string[] };
type SortKey = 'size' | 'newest' | 'oldest' | 'name';

function routeAppId() {
  const match = /^#game\/(\d+)$/.exec(window.location.hash);
  return match ? parseAppId(match[1]) : null;
}

function Cover({ game, small = false }: { game: Pick<CloudGame, 'appId' | 'name'>; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`cover cover-${game.appId % 5}${small ? ' cover-small' : ''}`}>
    <span className="cover-fallback" aria-hidden="true"><Gamepad2 size={small ? 24 : 40} strokeWidth={1.3} /></span>
    {!failed && <img src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`}
      alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>;
}

function NoticeBox({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
    <div>{notice.message}{!!notice.details?.length && <details><summary>Подробности</summary>{notice.details.map((detail, i) => <p key={i}>{detail}</p>)}</details>}</div>
    <button className="icon-button" onClick={onClose} aria-label="Закрыть уведомление"><X size={17} /></button>
  </div>;
}

function Login({ session, loading, error, onLogin, onRetry }: {
  session: SessionInfo | null; loading: boolean; error: string | null; onLogin: () => void; onRetry: () => void;
}) {
  const login = session?.login;
  const pending = login?.status === 'awaiting_confirmation' || login?.status === 'connecting';
  return <main className="login-shell">
    <section className="login-card">
      <span className="login-cloud"><Cloud size={34} strokeWidth={1.6} /></span>
      <span className="eyebrow">STEAM CLOUD MANAGER</span>
      <h1>Ваши сохранения.<br /><span>Всё под рукой.</span></h1>
      <p className="login-intro">Посмотрите, что хранится в облаке.<br />Скачайте важное. Удалите лишнее.</p>
      {session?.mode === 'demo' && <p className="demo-note">Демо: реальные сохранения не затрагиваются.</p>}
      {pending && login?.qrDataUrl ? <div className="qr-section">
        <img className="qr-code" src={login.qrDataUrl} alt="QR-код входа в Steam" width="224" height="224" />
        <p>Откройте Steam Guard на телефоне,<br />отсканируйте код и подтвердите вход.</p>
        <span className="loading-label"><LoaderCircle size={16} className="spin" />{login.status === 'connecting' ? 'Подключаемся…' : 'Ожидаем подтверждения'}</span>
      </div> : <button className="button button-primary login-button" onClick={onLogin} disabled={!session || loading || pending}>
        {loading || pending ? <LoaderCircle size={19} className="spin" /> : <Gamepad2 size={20} />}
        {loading || pending ? 'Подключение…' : session?.mode === 'demo' ? 'Посмотреть демо' : 'Войти через Steam'}
        {!loading && !pending && <ArrowRight size={18} />}
      </button>}
      {(error || login?.error) && <p className="inline-error" role="alert">{error || login?.error}</p>}
      {login?.status === 'expired' && <p className="inline-error">Код истёк. Нажмите «Войти через Steam» ещё раз.</p>}
      {!session && !loading && <button className="button button-secondary" onClick={onRetry}>Повторить подключение</button>}
      <div className="login-trust"><ShieldCheck size={17} /><p>Пароль здесь не нужен. QR подключает полную сессию Steam — используйте только свой или доверенный сервер.</p></div>
    </section>
    <footer className="login-footer">Личный инструмент · Не связан с Valve</footer>
  </main>;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [games, setGames] = useState<CloudGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(routeAppId);
  const [gameQuery, setGameQuery] = useState('');
  const [gameLimit, setGameLimit] = useState(GAME_PAGE_SIZE);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('size');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<'plan' | 'export' | 'delete' | null>(null);
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const sessionRequest = useRef<Promise<void> | null>(null);
  const gamesRequest = useRef(0);
  const selectionCheckbox = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const libraryScroll = useRef(0);
  const routeRef = useRef(selectedId);
  const busyRef = useRef(action);
  const connected = session?.login.status === 'connected';
  routeRef.current = selectedId;
  busyRef.current = action;

  const readSession = useCallback(() => {
    // Share StrictMode's initial request: cookie and CSRF must belong to one session.
    if (sessionRequest.current) return sessionRequest.current;
    setSessionLoading(true); setSessionError(null);
    const pending = api<SessionInfo>('/api/session').then(setSession)
      .catch(error => setSessionError(error instanceof Error ? error.message : 'Сервер недоступен.'))
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
      try { const value = await api<SessionInfo>('/api/session', { signal: controller.signal }); if (!cancelled) { setSession(value); setSessionError(null); } }
      catch (error) { if (!cancelled) setSessionError(error instanceof Error ? error.message : 'Соединение прервано.'); }
      if (!cancelled) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 1200);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [session?.login.status]);

  const resetFiles = useCallback(() => {
    setListing(null); setFilesError(null); setSelection(new Set()); setPlan(null); setNotice(null); setQuery(''); setPage(0);
  }, []);
  const navigate = useCallback((id: number | null) => {
    if (busyRef.current) return;
    if (id !== null && routeRef.current === null) libraryScroll.current = window.scrollY;
    window.history.pushState(null, '', id === null ? '#library' : `#game/${id}`);
    resetFiles(); setSelectedId(id);
  }, [resetFiles]);
  useEffect(() => {
    const changed = () => {
      if (busyRef.current) {
        window.history.replaceState(null, '', routeRef.current === null ? '#library' : `#game/${routeRef.current}`);
        return;
      }
      resetFiles(); setSelectedId(routeAppId());
    };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, [resetFiles]);
  useEffect(() => {
    if (!connected) return;
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: selectedId === null ? libraryScroll.current : 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, connected]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { void readSession(); setPlan(null); }
    setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' });
  }, [readSession]);
  const loadGames = useCallback(async () => {
    const id = ++gamesRequest.current;
    setGamesLoading(true); setGamesError(null);
    try {
      const result = await api<{ games: CloudGame[] }>('/api/games');
      if (id !== gamesRequest.current) return;
      setGames(previous => {
        const known = new Map(previous.map(game => [game.appId, game]));
        return result.games.map(game => {
          const old = known.get(game.appId);
          return old && game.fileCount === null ? { ...game, fileCount: old.fileCount, totalBytes: old.totalBytes } : game;
        }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      });
      // Do not auto-open the first game or read cloud files just to render the library.
    } catch (error) {
      if (id !== gamesRequest.current) return;
      setGamesError(error instanceof Error ? error.message : 'Не удалось загрузить игры.');
      if (error instanceof ApiError && error.status === 401) void readSession();
    } finally { if (id === gamesRequest.current) setGamesLoading(false); }
  }, [readSession]);
  useEffect(() => {
    if (connected) void loadGames();
    else { gamesRequest.current++; setGamesLoading(false); setGames([]); setGamesError(null); resetFiles(); }
  }, [connected, loadGames, resetFiles]);

  useEffect(() => {
    if (!connected || selectedId === null) return;
    let current = true;
    const controller = new AbortController();
    setFilesLoading(true); setFilesError(null); setListing(null);
    api<FileListing>(`/api/games/${selectedId}/files`, { signal: controller.signal }).then(result => {
      if (!current) return;
      setListing(result);
      const totalBytes = result.files.reduce((sum, file) => sum + file.size, 0);
      setGames(previous => previous.map(game => game.appId === result.appId ? { ...game, fileCount: result.files.length, totalBytes } : game));
      const available = new Set(result.files.map(file => file.name));
      setSelection(previous => new Set([...previous].filter(name => available.has(name))));
    }).catch(error => {
      if (!current) return;
      setFilesError(error instanceof Error ? error.message : 'Не удалось загрузить сохранения.');
      if (error instanceof ApiError && error.status === 401) void readSession();
    }).finally(() => { if (current) setFilesLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [connected, selectedId, refresh, readSession]);

  const visibleGames = useMemo(() => {
    const search = gameQuery.trim().toLocaleLowerCase();
    return games.filter(game => `${game.name} ${game.appId}`.toLocaleLowerCase().includes(search));
  }, [games, gameQuery]);
  const activeGame = games.find(game => game.appId === selectedId) ?? { appId: selectedId ?? 0, name: `Игра ${selectedId}`, fileCount: null, totalBytes: null };
  const sortedFiles = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (listing?.files ?? []).filter(file => file.name.toLocaleLowerCase().includes(search)).sort((a, b) =>
      (sort === 'size' ? b.size - a.size : sort === 'newest' ? b.modifiedAt - a.modifiedAt : sort === 'oldest' ? a.modifiedAt - b.modifiedAt : 0)
      || a.name.localeCompare(b.name, 'ru'));
  }, [listing, query, sort]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(sortedFiles.length / PAGE_SIZE) - 1));
  const pageFiles = sortedFiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectedFiles = (listing?.files ?? []).filter(file => selection.has(file.name));
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const allOnPage = pageFiles.length > 0 && pageFiles.every(file => selection.has(file.name));
  const someOnPage = pageFiles.some(file => selection.has(file.name));
  useEffect(() => { if (selectionCheckbox.current) selectionCheckbox.current.indeterminate = someOnPage && !allOnPage; }, [someOnPage, allOnPage]);

  const startLogin = async () => {
    if (!session) return;
    setSessionLoading(true); setSessionError(null);
    try { setSession(await api<SessionInfo>('/api/auth/steam', { body: {}, csrf: session.csrfToken })); }
    catch (error) { setSessionError(error instanceof Error ? error.message : 'Не удалось начать вход.'); }
    finally { setSessionLoading(false); }
  };
  const logout = async () => {
    if (!session || action) return;
    gamesRequest.current++; setSessionLoading(true);
    try {
      const next = await api<SessionInfo>('/api/auth/logout', { body: {}, csrf: session.csrfToken });
      setSession(next); setGameQuery(''); setGameLimit(GAME_PAGE_SIZE); setSelectedId(null); libraryScroll.current = 0;
      window.history.replaceState(null, '', '#library'); resetFiles();
    } catch (error) { handleError(error); }
    finally { setSessionLoading(false); }
  };
  const toggleFile = (name: string) => setSelection(previous => {
    const next = new Set(previous);
    if (next.has(name)) next.delete(name); else if (next.size < BATCH_LIMIT) next.add(name);
    return next;
  });
  const togglePage = () => setSelection(previous => {
    const next = new Set(previous);
    for (const file of pageFiles) { if (allOnPage) next.delete(file.name); else if (next.size < BATCH_LIMIT) next.add(file.name); }
    return next;
  });
  const exportFiles = async (files = selectedFiles) => {
    if (!session || !listing || !files.length || action) return;
    setAction('export'); setNotice(null);
    try {
      const result = await api<{ downloadUrl: string }>(`/api/games/${listing.appId}/exports`, { body: { names: files.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken });
      startDownload(result.downloadUrl);
      setNotice({ kind: 'info', message: 'Скачивание передано браузеру. Дождитесь его завершения перед удалением.' });
    } catch (error) { handleError(error); }
    finally { setAction(null); }
  };
  const prepareDelete = async () => {
    if (!session || !listing || !selectedFiles.length || action) return;
    setAction('plan'); setNotice(null);
    try { setPlan(await api<DeletePlan>(`/api/games/${listing.appId}/delete-plan`, { body: { names: selectedFiles.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken })); }
    catch (error) { handleError(error); }
    finally { setAction(null); }
  };
  const deleteFiles = async (confirmation: string) => {
    if (!session || !plan || action) return;
    setAction('delete');
    try {
      const result = await api<DeleteResult>(`/api/games/${plan.appId}/delete`, { body: { planId: plan.planId, confirmation, gamesClosed: true }, csrf: session.csrfToken });
      setPlan(null); setSelection(new Set());
      const incomplete = result.failed.length > 0 || !result.batchCompleted;
      setNotice({ kind: incomplete ? 'error' : 'success', message: incomplete
        ? `Удалено: ${result.deleted.length}. Ошибок: ${result.failed.length}.${!result.batchCompleted ? ' Steam не подтвердил завершение операции.' : ''} Проверьте обновлённый список.`
        : `Удалено: ${fileCountLabel(result.deleted.length)}.`, details: result.failed.map(file => `${file.name}: ${file.message}`) });
      setRefresh(value => value + 1);
    } catch (error) { handleError(error); setPlan(null); setRefresh(value => value + 1); }
    finally { setAction(null); }
  };

  if (!connected) return <Login session={session} loading={sessionLoading} error={sessionError} onLogin={() => void startLogin()} onRetry={() => void readSession()} />;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Перейти к содержимому</a>
    <header className="app-header"><div className="header-inner">
      <button className="brand" onClick={() => navigate(null)} disabled={!!action} aria-label="Все игры"><span className="brand-icon"><Cloud size={22} /></span><span>Steam Cloud</span></button>
      <div className="account"><span className="account-name"><span className="status-dot" />{session.login.user?.displayName || 'Steam'}</span><button className="icon-button" aria-label="Выйти из Steam" title="Выйти" onClick={() => void logout()} disabled={!!action || sessionLoading}><LogOut size={18} /></button></div>
    </div></header>
    <main id="main-content" tabIndex={-1} className={`main-content${selectedFiles.length ? ' has-selection' : ''}`}>
      {session.mode === 'demo' && <p className="demo-note">Демо-режим · Все сохранения вымышленные</p>}
      {notice && <NoticeBox notice={notice} onClose={() => setNotice(null)} />}
      {selectedId === null ? <>
        <div className="page-heading"><div><span className="eyebrow">ВАША БИБЛИОТЕКА</span><h1 ref={heading} tabIndex={-1}>Выберите игру</h1><p>А дальше — только её сохранения.</p></div><button className="icon-button refresh-library" title="Обновить игры" aria-label="Обновить игры" onClick={() => void loadGames()} disabled={gamesLoading}><RefreshCw size={19} className={gamesLoading ? 'spin' : ''} /></button></div>
        <div className="library-toolbar"><label className="search-field"><Search size={20} /><input aria-label="Найти игру" placeholder="Найти игру" value={gameQuery} onChange={event => { setGameQuery(event.target.value); setGameLimit(GAME_PAGE_SIZE); }} />{gameQuery && <button className="icon-button" onClick={() => { setGameQuery(''); setGameLimit(GAME_PAGE_SIZE); }} aria-label="Очистить поиск игр"><X size={17} /></button>}</label><span className="library-count">{gamesLoading && !games.length ? 'Загрузка…' : `${integer(visibleGames.length)} игр`}</span></div>
        {gamesError && <div className="empty-state compact" role="alert"><p>{gamesError}</p><button className="button button-secondary" onClick={() => void loadGames()} disabled={gamesLoading}>Попробовать снова</button></div>}
        {gamesLoading && !games.length ? <div className="game-grid" aria-label="Загрузка библиотеки" role="status">{Array.from({ length: 6 }, (_, i) => <div className="game-skeleton" key={i}><div /><span /><span /></div>)}</div>
          : visibleGames.length ? <><div className="game-grid">{visibleGames.slice(0, gameLimit).map(game => <a className="game-card" key={game.appId} href={`#game/${game.appId}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(game.appId); } }}>
            <Cover game={game} /><div className="game-card-body"><h2>{game.name}</h2><div className="game-card-bottom"><span>{game.fileCount === null ? 'Открыть сохранения' : game.fileCount === 0 ? 'В облаке пока пусто' : `${fileCountLabel(game.fileCount)} · ${bytes(game.totalBytes ?? 0)}`}</span><ArrowRight size={17} /></div></div>
          </a>)}</div>{visibleGames.length > gameLimit && <div className="load-more"><button className="button button-secondary" onClick={() => setGameLimit(limit => limit + GAME_PAGE_SIZE)}>Показать ещё <ChevronDown size={16} /></button><span>{Math.min(gameLimit, visibleGames.length)} из {visibleGames.length}</span></div>}</>
          : !gamesError && <div className="empty-state"><Gamepad2 size={36} strokeWidth={1.4} /><h2>{gameQuery ? 'Такой игры не нашлось' : 'Пока нет игр'}</h2><p>{gameQuery ? 'Попробуйте другое название или откройте игру по ссылке ниже.' : 'Обновите библиотеку или откройте игру по ссылке из Steam.'}</p>{gameQuery && <button className="button button-secondary" onClick={() => setGameQuery('')}>Сбросить поиск</button>}</div>}
        <details className="manual-game"><summary>Не нашли игру? Открыть по ссылке или AppID</summary><form onSubmit={event => {
          event.preventDefault(); const id = parseAppId(manualInput);
          if (id === null) { setManualError('Вставьте ссылку на страницу игры в Steam или её числовой AppID.'); return; }
          setManualError(null); setManualInput(''); navigate(id);
        }}><label className="sr-only" htmlFor="manual-app">Ссылка Steam или AppID</label><input id="manual-app" placeholder="Ссылка Steam или AppID, например 949230" value={manualInput} onChange={event => { setManualInput(event.target.value); setManualError(null); }} /><button className="button button-secondary" disabled={!manualInput.trim()}>Открыть <ArrowRight size={16} /></button></form>{manualError && <p className="inline-error" role="alert">{manualError}</p>}<p className="small-note">В библиотеке только игры — без DLC, саундтреков и инструментов. AppID — число после /app/ в адресе страницы Steam.</p></details>
      </> : <>
        <button className="back-button" onClick={() => navigate(null)} disabled={!!action}><ArrowLeft size={17} />Все игры</button>
        <div className="game-page-heading"><Cover key={activeGame.appId} game={activeGame} small /><div><h1 ref={heading} tabIndex={-1}>{activeGame.name}</h1><p>{listing ? `${fileCountLabel(listing.files.length)} · ${bytes(listing.files.reduce((sum, file) => sum + file.size, 0))}` : 'Облачные сохранения'}<span className="app-id">AppID {selectedId}</span></p></div><button className="icon-button" aria-label="Обновить сохранения" title="Обновить сохранения" onClick={() => setRefresh(value => value + 1)} disabled={filesLoading || !!action}><RefreshCw size={19} className={filesLoading ? 'spin' : ''} /></button></div>
        {filesLoading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={28} /><h2>Загружаем сохранения</h2><p>Сами файлы пока не скачиваются.</p></div>
          : filesError ? <div className="empty-state" role="alert"><Cloud size={34} /><h2>Не удалось получить файлы</h2><p>{filesError}</p><button className="button button-secondary" onClick={() => setRefresh(value => value + 1)}>Попробовать снова</button></div>
          : listing && !listing.files.length ? <div className="empty-state"><Cloud size={40} strokeWidth={1.3} /><h2>В облаке пока пусто</h2><p>Steam не вернул сохранений для этой игры.</p><button className="button button-secondary" onClick={() => navigate(null)}>К другим играм</button></div>
          : listing && <>
            <div className="file-toolbar"><label className="search-field"><Search size={18} /><input aria-label="Поиск сохранений" placeholder="Найти сохранение" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{query && <button className="icon-button" aria-label="Очистить поиск сохранений" onClick={() => { setQuery(''); setPage(0); }}><X size={16} /></button>}</label><select aria-label="Порядок файлов" value={sort} onChange={event => { setSort(event.target.value as SortKey); setPage(0); }}><option value="size">Сначала большие</option><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По имени</option></select></div>
            {sortedFiles.length ? <>
              <div className="file-list"><table><thead><tr><th className="check-cell"><input ref={selectionCheckbox} type="checkbox" aria-label="Выбрать файлы на странице" checked={allOnPage} onChange={togglePage} disabled={!!action || (selection.size >= BATCH_LIMIT && !someOnPage)} /></th><th>Файл</th><th className="size-cell">Размер</th><th className="date-cell">Изменён</th><th className="download-cell"><span className="sr-only">Скачать</span></th></tr></thead><tbody>{pageFiles.map((file, index) => <tr key={file.name} className={selection.has(file.name) ? 'row-selected' : ''}>
                <td className="check-cell"><input type="checkbox" id={`file-${index}`} aria-label={`Выбрать ${file.name}`} checked={selection.has(file.name)} onChange={() => toggleFile(file.name)} disabled={!!action || (!selection.has(file.name) && selection.size >= BATCH_LIMIT)} /></td>
                <td><label className="file-name" htmlFor={`file-${index}`}><File size={20} strokeWidth={1.6} /><span><span className="filename-text" title={file.name}>{basename(file.name)}</span><span className="mobile-file-meta">{bytes(file.size)} · {date(file.modifiedAt)}</span></span></label></td>
                <td className="size-cell">{bytes(file.size)}</td><td className="date-cell">{date(file.modifiedAt)}</td><td className="download-cell"><button className="icon-button" aria-label={`Скачать ${file.name}`} title="Скачать файл" disabled={!!action} onClick={() => { try { startDownload(`/api/games/${listing.appId}/download?name=${encodeURIComponent(file.name)}`); } catch (error) { handleError(error); } }}><Download size={17} /></button></td>
              </tr>)}</tbody></table></div>
              <div className="file-list-footer"><button className="text-button" disabled={!!action} onClick={() => setSelection(new Set(sortedFiles.slice(0, BATCH_LIMIT).map(file => file.name)))}>{sortedFiles.length > BATCH_LIMIT ? `Выбрать первые ${BATCH_LIMIT}` : 'Выбрать все найденные'}</button>{sortedFiles.length > PAGE_SIZE && <div className="pagination"><button className="icon-button" aria-label="Предыдущая страница" disabled={safePage === 0} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16} /></button><span>{safePage + 1} / {Math.ceil(sortedFiles.length / PAGE_SIZE)}</span><button className="icon-button" aria-label="Следующая страница" disabled={(safePage + 1) * PAGE_SIZE >= sortedFiles.length} onClick={() => setPage(value => value + 1)}><ArrowRight size={16} /></button></div>}</div>
            </> : <div className="empty-state compact"><h2>Ничего не нашлось</h2><button className="text-button" onClick={() => setQuery('')}>Сбросить поиск</button></div>}
            <p className="files-hint">Выберите файлы, чтобы скачать их вместе или удалить.</p>
          </>}
        {selectedFiles.length > 0 && <div className="bulk-actions" role="region" aria-label="Действия с выбранными файлами"><div className="bulk-summary"><span className="selection-icon"><Check size={18} /></span><div><strong>{fileCountLabel(selectedFiles.length)}</strong><small>{bytes(selectedBytes)}{selectedFiles.some(file => !sortedFiles.includes(file)) ? ' · есть скрытые фильтром' : ''}</small></div><button className="icon-button" aria-label="Снять выбор" onClick={() => setSelection(new Set())} disabled={!!action}><X size={16} /></button></div><div className="bulk-buttons"><button className="button button-secondary" onClick={() => void exportFiles()} disabled={!!action || filesLoading}>{action === 'export' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}Скачать ZIP</button><button className="button button-danger" onClick={() => void prepareDelete()} disabled={!!action || filesLoading}>{action === 'plan' ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}Удалить</button></div></div>}
      </>}
    </main>
    <footer className="app-footer"><Cloud size={14} /><span>Личный инструмент для Steam Cloud</span></footer>
    {plan && <DeleteDialog key={plan.planId} plan={plan} error={notice?.kind === 'error' ? notice.message : undefined} deleting={action === 'delete'} exporting={action === 'export'} onClose={() => { if (!action) setPlan(null); }} onDelete={value => void deleteFiles(value)} onBackup={() => void exportFiles(plan.files)} />}
  </div>;
}
