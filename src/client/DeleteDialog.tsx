import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, File, LoaderCircle, Trash2, X } from 'lucide-react';
import type { DeletePlan } from '../shared/types';
import { basename, bytes } from './format';

export default function DeleteDialog({ plan, deleting, exporting, error, onClose, onDelete, onBackup }: {
  plan: DeletePlan; deleting: boolean; exporting: boolean; error?: string;
  onClose: () => void; onDelete: (confirmation: string) => void; onBackup: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const [gamesClosed, setGamesClosed] = useState(false);
  const [expired, setExpired] = useState(Date.now() >= plan.expiresAt);
  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
    const timer = window.setInterval(() => setExpired(Date.now() >= plan.expiresAt), 1000);
    return () => { window.clearInterval(timer); node?.close(); };
  }, [plan.expiresAt]);
  const busy = deleting || exporting;
  return <dialog ref={ref} className="delete-dialog" aria-labelledby="delete-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="dialog-header">
      <div className="danger-icon"><Trash2 size={24} /></div>
      <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Закрыть подтверждение"><X size={20} /></button>
    </div>
    <h2 id="delete-title">Удалить сохранения?</h2>
    <p className="muted">Из Steam Cloud будут удалены <strong>{plan.files.length} файлов</strong>, занимающих <strong>{bytes(plan.totalBytes)}</strong>.</p>
    <div className="delete-warning"><AlertTriangle size={19} /><span>Steam не хранит корзину или предыдущие версии. Удаление необратимо. Сначала скачайте файлы, которые могут понадобиться.</span></div>
    <div className="delete-files" aria-label="Файлы к удалению">{plan.files.map(file => <div className="delete-file" key={file.name}>
      <File size={16} /><div><strong>{basename(file.name)}</strong><small>{file.name}</small></div><span>{bytes(file.size)}</span>
    </div>)}</div>
    <button className="button button-secondary backup-button" onClick={onBackup} disabled={busy || expired}>
      {exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Скачать эти файлы в ZIP
    </button>
    <p className="backup-reminder">Дождитесь окончания скачивания перед удалением.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); if (!busy && !expired && gamesClosed && confirmation === plan.confirmation) onDelete(confirmation); }}>
      <label className="checkbox-label warning-check"><input type="checkbox" checked={gamesClosed} onChange={event => setGamesClosed(event.target.checked)} disabled={busy} />
        <span>Я закрыл игру и сессии GeForce NOW на всех устройствах.<small>Иначе синхронизация может вернуть файлы в облако.</small></span>
      </label>
      <label className="confirm-label" htmlFor="delete-confirmation">Для подтверждения введите <strong>{plan.confirmation}</strong></label>
      <input id="delete-confirmation" className="text-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy || expired} autoComplete="off" spellCheck={false} placeholder={plan.confirmation} />
      {expired && <p className="inline-error" role="alert">Подтверждение устарело. Закройте окно и выберите удаление заново.</p>}
      <div className="dialog-actions">
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Отмена</button>
        <button className="button button-danger" type="submit" disabled={busy || expired || !gamesClosed || confirmation !== plan.confirmation}>
          {deleting ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{deleting ? 'Удаление…' : 'Удалить навсегда'}
        </button>
      </div>
    </form>
  </dialog>;
}
