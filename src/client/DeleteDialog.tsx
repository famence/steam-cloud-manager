import { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Trash2, X } from 'lucide-react';
import type { DeletePlan } from '../shared/types';
import { basename } from './format';
import { usePreferences } from './preferences';
import { countFiles, formatBytes } from './i18n';
export default function DeleteDialog({ plan, deleting, exporting, error, onClose, onDelete, onBackup, preparedExport }: {
  plan: DeletePlan; deleting: boolean; exporting: boolean; error?: string; preparedExport?: string | null;
  onClose: () => void; onDelete: (confirmation: string) => void; onBackup: () => void;
}) {
  const { t, locale } = usePreferences(); const ref = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState(''); const [gamesClosed, setGamesClosed] = useState(false);
  const [expired, setExpired] = useState(Date.now() >= plan.expiresAt); const busy = deleting || exporting;
  useEffect(() => { const node = ref.current; node?.showModal(); const timer = setInterval(() => setExpired(Date.now() >= plan.expiresAt), 1000);
    return () => { clearInterval(timer); node?.close(); }; }, [plan.expiresAt]);
  return <dialog ref={ref} className="dialog delete-dialog" aria-labelledby="delete-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <div className="dialog-top"><h2 id="delete-title">{t.deleteTitle}</h2><button className="icon-button" onClick={onClose} disabled={busy} aria-label={t.close}><X size={20} /></button></div>
    <p>{countFiles(plan.files.length, locale)} · {formatBytes(plan.totalBytes, locale)}</p><p className="delete-warning">{t.deleteWarning}</p>
    <div className="delete-files">{plan.files.map(file => <div className="delete-file" key={file.name}><div><strong>{basename(file.name)}</strong><small>{file.name}</small></div><span>{formatBytes(file.size, locale)}</span></div>)}</div>
    <button type="button" className="button full-width" onClick={onBackup} disabled={busy || expired}>{exporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}{exporting ? t.downloading : t.zip}</button>
    {preparedExport && <a className="button button-primary full-width" href={preparedExport} download>{t.downloadPrepared}</a>}
    <p className="helper-text">{t.backupNotice}</p>{error && <p className="error-message" role="alert">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); if (!busy && !expired && gamesClosed && confirmation === plan.confirmation) onDelete(confirmation); }}>
      <label className="check-line"><input type="checkbox" checked={gamesClosed} onChange={e => setGamesClosed(e.target.checked)} disabled={busy} /><span>{t.gamesClosed}</span></label>
      <label className="confirmation-label" htmlFor="delete-confirmation">{t.typePhrase} <strong>{plan.confirmation}</strong></label>
      <input id="delete-confirmation" className="text-input" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy || expired} autoComplete="off" spellCheck={false} />
      {expired && <p className="error-message" role="alert">{t.expiredPlan}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>{t.cancel}</button><button type="submit" className="button button-danger" disabled={busy || expired || !gamesClosed || confirmation !== plan.confirmation}>{deleting ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}{t.confirmDelete}</button></div>
    </form>
  </dialog>;
}
