export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, options: { body?: unknown; csrf?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : {
      'Content-Type': 'application/json',
      'x-csrf-token': options.csrf || '',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
    throw new ApiError(response.status, typeof message === 'string' ? message : `Не удалось выполнить запрос (${response.status}). Попробуйте ещё раз.`);
  }
  return data as T;
}

/** Never navigate to an arbitrary URL returned by a server response. */
export function checkedDownloadUrl(url: string): string {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/')) {
    throw new Error('Получен некорректный адрес скачивания.');
  }
  return target.href;
}

export function startDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = checkedDownloadUrl(url);
  anchor.setAttribute('download', '');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

interface SaveFileHandle {
  createWritable(): Promise<WritableStream<Uint8Array>>;
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveFileHandle>;
}

/**
 * Must be called directly within a user click. A picker cannot be reliably
 * opened after an awaited POST (transient user activation has expired).
 */
export function chooseSaveDestination(filename: string): Promise<SaveFileHandle> | null {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  return picker.call(window, { suggestedName: filename });
}

export function isCancelledSave(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Stream directly to a file (no multi-gigabyte Blob in browser memory).
 * On HTTP failure, show a real API error. A partial transfer aborts the file.
 */
export async function streamToSavedFile(url: string, handle: SaveFileHandle): Promise<void> {
  const response = await fetch(checkedDownloadUrl(url), {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data?.error?.message || data?.message;
    throw new ApiError(response.status, typeof message === 'string'
      ? message : `Steam не отдал файл (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error('Браузер не поддерживает потоковое скачивание.');
  const writable = await handle.createWritable();
  try {
    await response.body.pipeTo(writable);
  } catch (error) {
    await writable.abort().catch(() => {});
    throw new Error(error instanceof Error
      ? `Скачивание прервалось: ${error.message}`
      : 'Скачивание прервалось. Неполный файл не был сохранён.');
  }
}
