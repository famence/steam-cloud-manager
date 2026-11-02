import { createHash } from 'node:crypto';
import type { CloudFile } from '../shared/types.js';
import type { DriverListing } from './steam/contracts.js';
import { AppError } from './errors.js';

export function fileRevision(listing: DriverListing): string {
  return createHash('sha256').update(JSON.stringify({
    appId: listing.appId, change: listing.changeNumber,
    files: [...listing.files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map((f) => [f.name, f.size, f.modifiedAt, f.sha]),
  })).digest('hex');
}

export function selectFiles(listing: DriverListing, names: string[], revision: string): CloudFile[] {
  if (fileRevision(listing) !== revision) throw new AppError(409, 'FILES_CHANGED', 'Список сохранений изменился. Обновите его и выберите файлы заново.');
  const byName = new Map(listing.files.map((file) => [file.name, file]));
  return names.map((name) => {
    const file = byName.get(name);
    if (!file) throw new AppError(409, 'FILE_MISSING', 'Один из выбранных файлов уже отсутствует. Обновите список.');
    return file;
  });
}

// Opaque Steam keys never become filesystem paths. ZIP entries have generated,
// unique basenames; the manifest preserves the exact original Steam names.
export function archiveEntryName(file: CloudFile, index: number) {
  const base = file.name.replaceAll('\\', '/').split('/').pop() || 'save';
  const safe = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '_').slice(0, 160) || 'save';
  return `saves/${String(index + 1).padStart(4, '0')}-${safe}`;
}

export function contentDisposition(name: string) {
  const base = name.replaceAll('\\', '/').split('/').pop() || 'save';
  const safe = base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160) || 'save';
  const encoded = encodeURIComponent(base.replace(/[\r\n\x00]/g, '').slice(0, 240)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
