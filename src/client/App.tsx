import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Cloud, Download, File, Gamepad2, LoaderCircle, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import type { CloudFile, CloudGame, DeletePlan, DeleteResult, FileListing, GameSummary, SessionInfo } from '../shared/types';
import { api, ApiError, checkedDownloadUrl, chooseSaveDestination, isCancelledSave, startDownload, streamToSavedFile } from './api';
import { basename } from './format';
import { parseAppId } from './library';
import { countFiles, errorText, formatBytes, type Messages } from './i18n';
import { useFavorites, usePreferences } from './preferences';
import { isInactive, orderGames } from './library-order';
import { Shell } from './components/Shell';
import DeleteDialog from './DeleteDialog';

const FILE_LIMIT = 500;
const FILE_PAGE = 100;
const GAME_PAGE = 24;
type Notice = { kind: 'success' | 'info' | 'error'; key?: keyof Messages; error?: unknown; extra?: string; files?: string[] };
type Action = 'export' | 'plan' | 'delete' | null;
function routeId(): number | null { return parseAppId(/^#game\/(\d+)$/.exec(location.hash)?.[1] ?? ''); }
function Cover({ game }: { game: CloudGame }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => setState('loading'), [game.appId]);
  return <span className={`cover${state === 'loading' ? ' skeleton' : ''}`}>
    {state !== 'ready' && <Gamepad2 className="cover-fallback" size={36} aria-hidden="true" />}
    {state !== 'failed' && <img src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`}
      alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={state === 'ready' ? 'ready' : ''}
      onLoad={() => setState('ready')} onError={() => setState('failed')} />}
  </span>;
}
function GameSkeletons({ count = 6 }: { count?: number }) {
  const { t } = usePreferences();
  return <div className="game-grid" role="status" aria-label={t.loadingGames}>{Array.from({ length: count }, (_, i) =>
    <div className="game-card game-skeleton" key={i} aria-hidden="true"><span className="cover skeleton" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /></div>)}</div>;
}
export default function App() {
  const { t, locale } = usePreferences();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [games, setGames] = useState<CloudGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<unknown>(null);
  const [gamesVersion, setGamesVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(routeId);
  const [gameQuery, setGameQuery] = useState('');
  const [gameLimit, setGameLimit] = useState(GAME_PAGE);
  const [revealing, setRevealing] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('size');
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>(null);
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [preparedExport, setPreparedExport] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checking, setChecking] = useState<Set<number>>(new Set());
  const [checkFailed, setCheckFailed] = useState<Set<number>>(new Set());
  const connected = session?.login.status === 'connected';
  const account = connected ? session.login.user?.steamId ?? 'demo' : '';
  const { favorites, toggleFavorite } = useFavorites(account);
  const accountRef = useRef(account); accountRef.current = account;
  const sessionRequest = useRef<Promise<void> | null>(null);
  const libraryRequest = useRef(0);
  const attempted = useRef(new Set<number>());
  const checkBox = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const libraryScroll = useRef(0);
  const revealFrame = useRef(0);
  const routeRef = useRef(selectedId); routeRef.current = selectedId;
  const busyRef = useRef(action); busyRef.current = action;

  const readSession = useCallback(() => {
    if (sessionRequest.current) return sessionRequest.current;
    setSessionLoading(true); setSessionError(null);
    const pending = api<SessionInfo>('/api/session').then(setSession).catch(setSessionError)
      .finally(() => { sessionRequest.current = null; setSessionLoading(false); });
    sessionRequest.current = pending; return pending;
  }, []);
  useEffect(() => { void readSession(); }, [readSession]);
  useEffect(() => {
    if (!session || !['awaiting_confirmation', 'connecting'].includes(session.login.status)) return;
    let current = true; let timer: ReturnType<typeof setTimeout>; const controller = new AbortController();
    const poll = async () => {
      try { const value = await api<SessionInfo>('/api/session', { signal: controller.signal }); if (current) { setSession(value); setSessionError(null); } }
      catch (error) { if (current) setSessionError(error); }
      if (current) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 1200);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [session?.login.status]);
  const handleError = useCallback((error: unknown) => {
    setNotice({ kind: 'error', error });
    if (error instanceof ApiError && error.status === 401) { setPlan(null); void readSession(); }
  }, [readSession]);
  const resetFiles = useCallback(() => {
    setListing(null); setFilesError(null); setSelection(new Set()); setPlan(null); setNotice(null);
    setPreparedExport(null); setQuery(''); setPage(0);
  }, []);
  const navigate = useCallback((id: number | null) => {
    if (busyRef.current) return;
    if (id !== null && routeRef.current === null) libraryScroll.current = window.scrollY;
    history.pushState(null, '', id === null ? '#library' : `#game/${id}`);
    resetFiles(); setSelectedId(id);
  }, [resetFiles]);
  useEffect(() => {
    const onRoute = () => {
      if (busyRef.current) { history.replaceState(null, '', routeRef.current === null ? '#library' : `#game/${routeRef.current}`); return; }
      const id = routeId(); if (id !== routeRef.current) { resetFiles(); setSelectedId(id); }
    };
    addEventListener('popstate', onRoute); addEventListener('hashchange', onRoute);
    return () => { removeEventListener('popstate', onRoute); removeEventListener('hashchange', onRoute); };
  }, [resetFiles]);
  useEffect(() => {
    if (!connected) return;
    const frame = requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: selectedId === null ? libraryScroll.current : 0, behavior: 'instant' }); });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, connected]);
  const loadGames = useCallback(async () => {
    const id = ++libraryRequest.current; const owner = accountRef.current;
    setGamesLoading(true); setGamesError(null);
    try {
      const result = await api<{ games: CloudGame[] }>('/api/games');
      if (id !== libraryRequest.current || owner !== accountRef.current) return;
      setGames(result.games); attempted.current.clear(); setChecking(new Set()); setCheckFailed(new Set());
      setGamesVersion(v => v + 1);
    } catch (error) { if (id === libraryRequest.current) { setGamesError(error); if (error instanceof ApiError && error.status === 401) void readSession(); } }
    finally { if (id === libraryRequest.current) setGamesLoading(false); }
  }, [readSession]);
  useEffect(() => {
    libraryRequest.current++; setGames([]); attempted.current.clear(); setChecking(new Set()); setCheckFailed(new Set());
    if (connected) void loadGames(); else { setGamesLoading(false); resetFiles(); }
  }, [connected, account, loadGames, resetFiles]);
  useEffect(() => {
    if (!connected || selectedId === null) return;
    let current = true; const controller = new AbortController();
    setFilesLoading(true); setFilesError(null); setListing(null);
    api<FileListing>(`/api/games/${selectedId}/files`, { signal: controller.signal }).then(result => {
      if (!current) return;
      setListing(result);
      setGames(previous => previous.map(game => game.appId === result.appId ? { ...game, fileCount: result.files.length,
        totalBytes: result.files.reduce((sum, file) => sum + file.size, 0),
        cloudSupport: result.files.length > 0 ? 'supported' : game.cloudSupport } : game));
      const names = new Set(result.files.map(file => file.name));
      setSelection(previous => new Set([...previous].filter(name => names.has(name))));
    }).catch(error => { if (current) { setFilesError(error); if (error instanceof ApiError && error.status === 401) void readSession(); } })
      .finally(() => { if (current) setFilesLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [connected, selectedId, refresh, readSession]);

  const orderedGames = useMemo(() => orderGames(games, favorites, locale), [games, favorites, locale]);
  const visibleGames = useMemo(() => { const q = gameQuery.trim().toLocaleLowerCase();
    return orderedGames.filter(game => `${game.name} ${game.appId}`.toLocaleLowerCase().includes(q)); }, [orderedGames, gameQuery]);
  // Hydrate only a snapshot of the revealed batch. Status-driven reordering must not trigger a sweep of the whole account.
  useEffect(() => {
    if (!connected || selectedId !== null || !gamesVersion) return;
    const candidates = visibleGames.slice(0, gameLimit).filter(game => game.fileCount === null
      && game.cloudSupport !== 'unsupported' && !attempted.current.has(game.appId));
    if (!candidates.length) return;
    let cursor = 0; let current = true; const controller = new AbortController();
    const worker = async () => {
      while (current && cursor < candidates.length) {
        const id = candidates[cursor++].appId; attempted.current.add(id);
        setChecking(previous => new Set(previous).add(id));
        try {
          const result = await api<GameSummary>(`/api/games/${id}/summary`, { signal: controller.signal });
          if (current) setGames(previous => previous.map(game => game.appId === id ? { ...game, ...result,
            cloudSupport: result.fileCount > 0 ? 'supported' : game.cloudSupport } : game));
        } catch (error) {
          if (current) setCheckFailed(previous => new Set(previous).add(id));
          else attempted.current.delete(id);
          if (error instanceof ApiError && error.status === 401) { if (current) void readSession(); break; }
        } finally { if (current) setChecking(previous => { const next = new Set(previous); next.delete(id); return next; }); }
      }
    };
    void worker(); void worker();
    return () => { current = false; controller.abort(); setChecking(new Set()); };
    // Deliberate snapshot dependencies; games/visibleGames change as the batch returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, account, gamesVersion, gameLimit, gameQuery, selectedId, readSession]);
  const revealMore = useCallback(() => {
    if (revealing || gameLimit >= visibleGames.length) return;
    setRevealing(true);
    revealFrame.current = requestAnimationFrame(() => { revealFrame.current = requestAnimationFrame(() => {
      setGameLimit(v => Math.min(v + GAME_PAGE, visibleGames.length)); setRevealing(false);
    }); });
  }, [revealing, gameLimit, visibleGames.length]);
  useEffect(() => () => cancelAnimationFrame(revealFrame.current), []);
  useEffect(() => {
    if (selectedId !== null || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) revealMore(); }, { rootMargin: '180px' });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [selectedId, revealMore]);

  const activeGame: CloudGame = games.find(game => game.appId === selectedId)
    ?? { appId: selectedId ?? 0, name: `${t.game} ${selectedId}`, fileCount: null, totalBytes: null };
  const sortedFiles = useMemo(() => (listing?.files ?? []).filter(file => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) =>
    (sort === 'size' ? b.size - a.size : sort === 'newest' ? b.modifiedAt - a.modifiedAt : sort === 'oldest' ? a.modifiedAt - b.modifiedAt : 0)
      || a.name.localeCompare(b.name, locale)), [listing, query, sort, locale]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(sortedFiles.length / FILE_PAGE) - 1));
  const pageFiles = sortedFiles.slice(safePage * FILE_PAGE, (safePage + 1) * FILE_PAGE);
  const selectedFiles = (listing?.files ?? []).filter(file => selection.has(file.name));
  const allOnPage = pageFiles.length > 0 && pageFiles.every(file => selection.has(file.name));
  const someOnPage = pageFiles.some(file => selection.has(file.name));
  useEffect(() => { if (checkBox.current) checkBox.current.indeterminate = someOnPage && !allOnPage; }, [someOnPage, allOnPage]);
  const changeSelection = (next: Set<string>) => { setSelection(next); setPreparedExport(null); };
  const toggleFile = (name: string) => { const next = new Set(selection); if (next.has(name)) next.delete(name); else if (next.size < FILE_LIMIT) next.add(name); changeSelection(next); };
  const togglePage = () => { const next = new Set(selection); for (const file of pageFiles) { if (allOnPage) next.delete(file.name); else if (next.size < FILE_LIMIT) next.add(file.name); } changeSelection(next); };
  const startLogin = async () => {
    if (!session) return; setSessionLoading(true); setSessionError(null);
    try { setSession(await api<SessionInfo>('/api/auth/steam', { body: {}, csrf: session.csrfToken })); }
    catch (error) { setSessionError(error); } finally { setSessionLoading(false); }
  };
  const logout = async () => {
    if (!session || action) return; libraryRequest.current++; setSessionLoading(true);
    try { setSession(await api<SessionInfo>('/api/auth/logout', { body: {}, csrf: session.csrfToken }));
      setGameQuery(''); setGameLimit(GAME_PAGE); navigate(null); }
    catch (error) { handleError(error); } finally { setSessionLoading(false); }
  };
  const exportFiles = async (files = selectedFiles) => {
    if (!session || !listing || !files.length || action) return;
    setAction('export'); setNotice(null); setPreparedExport(null);
    try {
      const picker = chooseSaveDestination(`steam-cloud-${listing.appId}.zip`);
      const handle = picker ? await picker : null;
      const result = await api<{ downloadUrl: string }>(`/api/games/${listing.appId}/exports`, {
        body: { names: files.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken });
      const url = checkedDownloadUrl(result.downloadUrl);
      if (handle) { await streamToSavedFile(url, handle); setNotice({ kind: 'success', key: 'backupDone' }); }
      else { setPreparedExport(url); setNotice({ kind: 'info', key: 'backupReady' }); }
    } catch (error) { if (!isCancelledSave(error)) handleError(error); }
    finally { setAction(null); }
  };
  const downloadSingle = async (file: CloudFile) => {
    if (!listing || action) return;
    setAction('export'); setNotice(null);
    try {
      const url = `/api/games/${listing.appId}/download?name=${encodeURIComponent(file.name)}`;
      const picker = chooseSaveDestination(basename(file.name));
      if (picker) { await streamToSavedFile(url, await picker); setNotice({ kind: 'success', key: 'backupDone' }); }
      else { startDownload(url); setNotice({ kind: 'info', key: 'backupNotice' }); }
    } catch (error) { if (!isCancelledSave(error)) handleError(error); }
    finally { setAction(null); }
  };
  const prepareDelete = async () => {
    if (!session || !listing || !selectedFiles.length || action) return;
    setAction('plan'); setNotice(null); setPreparedExport(null);
    try { setPlan(await api<DeletePlan>(`/api/games/${listing.appId}/delete-plan`, {
      body: { names: selectedFiles.map(file => file.name), revision: listing.revision }, csrf: session.csrfToken })); }
    catch (error) { handleError(error); } finally { setAction(null); }
  };
  const deleteFiles = async (confirmation: string) => {
    if (!session || !plan || action) return; setAction('delete');
    try {
      const result = await api<DeleteResult>(`/api/games/${plan.appId}/delete`, { body: { planId: plan.planId, confirmation, gamesClosed: true }, csrf: session.csrfToken });
      setPlan(null); changeSelection(new Set());
      setNotice(result.failed.length || !result.batchCompleted ? { kind: 'error', key: 'deletePartial', files: result.failed.map(file => file.name) }
        : { kind: 'success', key: 'deleteDone', extra: String(result.deleted.length) });
      setRefresh(v => v + 1);
    } catch (error) { handleError(error); setPlan(null); setRefresh(v => v + 1); }
    finally { setAction(null); }
  };
  const pending = session && ['awaiting_confirmation', 'connecting'].includes(session.login.status);
  const noticeText = notice?.error ? errorText(notice.error, locale) : notice?.key ? `${t[notice.key]}${notice.extra ? ` ${notice.extra}` : ''}` : '';
  const statusText = (game: CloudGame) => game.fileCount !== null && game.fileCount > 0
    ? `${countFiles(game.fileCount, locale)} · ${formatBytes(game.totalBytes ?? 0, locale)}`
    : game.cloudSupport === 'unsupported' ? t.unsupported : game.fileCount === 0 ? t.noSaves
      : checking.has(game.appId) ? t.checking : checkFailed.has(game.appId) ? t.checkFailed : t.unknownCloud;
  return <Shell onHome={() => navigate(null)} account={connected ? session.login.user?.displayName : undefined} onLogout={connected ? () => void logout() : undefined} busy={!!action || sessionLoading}>
    <main className={`main-content${selectedFiles.length ? ' has-selection' : ''}`}>
      {!connected ? <section className="login-card">
        <Cloud size={35} className="login-icon" /><h1>{t.title}</h1><p>{t.description}</p>
        {session?.mode === 'demo' && <p className="demo-note">{t.demo}</p>}
        {pending && session.login.qrDataUrl ? <div className="qr-section"><img src={session.login.qrDataUrl} alt="Steam QR" width="224" height="224" /><p>{t.qrInstructions}</p><p className="loading-label"><LoaderCircle size={17} className="spin" />{session.login.status === 'connecting' ? t.connecting : t.waiting}</p></div>
          : <button className="button button-primary full-width" onClick={() => void startLogin()} disabled={!session || sessionLoading || !!pending}>{sessionLoading || pending ? <LoaderCircle className="spin" size={18} /> : <Gamepad2 size={19} />}{sessionLoading || pending ? t.connecting : session?.mode === 'demo' ? t.demoButton : t.signIn}</button>}
        {(sessionError || session?.login.error) && <p className="error-message" role="alert">{sessionError ? errorText(sessionError, locale) : t.loginFailed}</p>}
        {session?.login.status === 'expired' && <p className="error-message">{t.expiredLogin}</p>}
        {!session && !sessionLoading && <button className="button" onClick={() => void readSession()}>{t.retry}</button>}
        <p className="helper-text">{t.sessionLocal}</p>
      </section> : <>
        {session.mode === 'demo' && <p className="demo-note">{t.demo}</p>}
        {notice && <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><div>{noticeText}{!!notice.files?.length && <details><summary>{t.details}</summary>{notice.files.map(name => <p key={name}>{name}</p>)}</details>}</div><button className="icon-button" aria-label={t.close} onClick={() => setNotice(null)}><X size={17} /></button></div>}
        {!plan && preparedExport && <p><a className="button button-primary" href={preparedExport} download>{t.downloadPrepared}</a></p>}
        {selectedId === null ? <>
          <div className="page-heading"><h1 ref={heading} tabIndex={-1}>{t.library}<span className="count-label">{games.length || ''}</span></h1><button className="icon-button" aria-label={t.refresh} onClick={() => void loadGames()} disabled={gamesLoading}><RefreshCw size={20} className={gamesLoading ? 'spin' : ''} /></button></div>
          <label className="search-field"><Search size={20} /><input type="search" aria-label={t.searchGames} placeholder={t.searchGames} value={gameQuery} onChange={e => { setGameQuery(e.target.value); setGameLimit(GAME_PAGE); }} /></label>
          <details className="manual-open"><summary>{t.openManual}</summary><form onSubmit={e => { e.preventDefault(); const id = parseAppId(manual); setManualError(id === null); if (id !== null) navigate(id); }}><input className="text-input" aria-label={t.manualHint} placeholder={t.manualHint} value={manual} onChange={e => { setManual(e.target.value); setManualError(false); }} /><button className="button" disabled={!manual.trim()}>{t.open}</button></form>{manualError && <p className="error-message" role="alert">{t.manualInvalid}</p>}</details>
          {gamesError && <div className="notice notice-error" role="alert">{errorText(gamesError, locale)}<button className="button" onClick={() => void loadGames()} disabled={gamesLoading}>{t.retry}</button></div>}
          {gamesLoading && !games.length ? <GameSkeletons /> : !visibleGames.length ? <div className="empty-state"><Gamepad2 size={34} /><h2>{t.noGames}</h2>{!games.length && <p>{t.emptyLibrary}</p>}</div> : <>
            <div className="game-grid">{visibleGames.slice(0, gameLimit).map(game => <article className={`game-card${isInactive(game) ? ' game-inactive' : ''}`} key={game.appId} data-app-id={game.appId}>
              <button className="game-open" onClick={() => navigate(game.appId)} aria-label={`${t.open}: ${game.name}`}><Cover game={game} /><span className="game-info"><strong>{game.name}</strong><small>{statusText(game)}</small></span></button>
              <button className={`favorite-button${favorites.has(game.appId) ? ' is-favorite' : ''}`} onClick={() => toggleFavorite(game.appId)} aria-label={`${favorites.has(game.appId) ? t.favoriteRemove : t.favoriteAdd}: ${game.name}`} aria-pressed={favorites.has(game.appId)} title={favorites.has(game.appId) ? t.favoriteRemove : t.favoriteAdd}><Star size={19} fill={favorites.has(game.appId) ? 'currentColor' : 'none'} /></button>
            </article>)}</div>
            {gameLimit < visibleGames.length && <div ref={sentinel} className="load-more">{revealing ? <GameSkeletons count={3} /> : <button className="button" onClick={revealMore}>{t.loadMore}</button>}</div>}
          </>}
          <p className="helper-text library-hint">{t.statusHint} {t.favoriteHint}</p>
        </> : <>
          <button className="back-button" onClick={() => navigate(null)} disabled={!!action}><ArrowLeft size={18} />{t.back}</button>
          <div className="page-heading file-heading"><div><h1 ref={heading} tabIndex={-1}>{activeGame.name}</h1><p className="helper-text">AppID {selectedId}{listing ? ` · ${countFiles(listing.files.length, locale)} · ${formatBytes(listing.files.reduce((sum, file) => sum + file.size, 0), locale)}` : ''}</p></div><button className="icon-button" aria-label={t.refresh} disabled={filesLoading || !!action} onClick={() => { setPreparedExport(null); setRefresh(v => v + 1); }}><RefreshCw size={20} className={filesLoading ? 'spin' : ''} /></button></div>
          {filesLoading ? <div className="file-skeletons" role="status" aria-label={t.loadingFiles}>{Array.from({ length: 5 }, (_, i) => <div className="skeleton file-skeleton" key={i} />)}</div>
            : filesError ? <div className="empty-state"><p className="error-message" role="alert">{errorText(filesError, locale)}</p><button className="button" onClick={() => setRefresh(v => v + 1)}>{t.retry}</button></div>
              : listing && !listing.files.length ? <div className="empty-state"><Cloud size={34} /><h2>{activeGame.cloudSupport === 'unsupported' ? t.unsupported : t.noSaves}</h2></div>
                : listing && <>
                  <div className="file-toolbar"><label className="search-field"><Search size={18} /><input type="search" aria-label={t.searchFiles} placeholder={t.searchFiles} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><select className="sort-select" aria-label={t.sort} value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="size">{t.sortSize}</option><option value="newest">{t.sortNewest}</option><option value="oldest">{t.sortOldest}</option><option value="name">{t.sortName}</option></select></div>
                  <div className="file-table-wrap"><table className="file-table"><thead><tr><th className="checkbox-cell"><input ref={checkBox} type="checkbox" aria-label={t.selectPage} checked={allOnPage} disabled={!!action} onChange={togglePage} /></th><th>{t.name}</th><th className="size-cell">{t.size}</th><th className="date-cell">{t.modified}</th><th><span className="sr-only">{t.download}</span></th></tr></thead><tbody>
                    {pageFiles.map(file => <tr key={file.name} className={selection.has(file.name) ? 'row-selected' : ''}><td className="checkbox-cell"><input type="checkbox" aria-label={file.name} checked={selection.has(file.name)} disabled={!!action || (!selection.has(file.name) && selection.size >= FILE_LIMIT)} onChange={() => toggleFile(file.name)} /></td><td className="filename"><File size={18} aria-hidden="true" /><span><strong>{basename(file.name)}</strong><small title={file.name}>{file.name}</small><span className="mobile-file-meta">{formatBytes(file.size, locale)}</span></span></td><td className="size-cell">{formatBytes(file.size, locale)}</td><td className="date-cell">{new Date(file.modifiedAt * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="download-cell"><button className="icon-button" aria-label={`${t.download}: ${file.name}`} disabled={!!action} onClick={() => void downloadSingle(file)}><Download size={18} /></button></td></tr>)}
                  </tbody></table></div>
                  {!sortedFiles.length && <p className="empty-state">{t.noFiles}</p>}
                  <div className="file-list-footer"><button className="text-button" disabled={!!action || !sortedFiles.length} onClick={() => changeSelection(new Set(sortedFiles.slice(0, FILE_LIMIT).map(file => file.name)))}>{t.selectAll}</button>{sortedFiles.length > FILE_PAGE && <div className="pagination"><button className="icon-button" aria-label={t.previous} disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ArrowLeft size={17} /></button><span>{safePage + 1} / {Math.ceil(sortedFiles.length / FILE_PAGE)}</span><button className="icon-button" aria-label={t.next} disabled={(safePage + 1) * FILE_PAGE >= sortedFiles.length} onClick={() => setPage(safePage + 1)}><ArrowRight size={17} /></button></div>}</div><p className="helper-text">{t.limitHint}</p>
                </>}
          {!!selectedFiles.length && <div className="bulk-actions"><div className="bulk-summary"><Check size={18} /><span>{countFiles(selectedFiles.length, locale)} · {formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0), locale)}</span><button className="icon-button" aria-label={t.clearSelection} onClick={() => changeSelection(new Set())} disabled={!!action}><X size={17} /></button></div><div className="bulk-buttons"><button className="button" onClick={() => void exportFiles()} disabled={!!action || filesLoading}>{action === 'export' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{t.zip}</button><button className="button button-danger" onClick={() => void prepareDelete()} disabled={!!action || filesLoading}>{action === 'plan' ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{t.remove}</button></div></div>}
        </>}
      </>}
    </main>
    {plan && <DeleteDialog key={plan.planId} plan={plan} error={notice?.kind === 'error' ? noticeText : undefined} deleting={action === 'delete'} exporting={action === 'export'} preparedExport={preparedExport} onClose={() => { if (!action) setPlan(null); }} onDelete={value => void deleteFiles(value)} onBackup={() => void exportFiles(plan.files)} />}
  </Shell>;
}
