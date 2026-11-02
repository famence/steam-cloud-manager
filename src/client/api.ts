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

export function startDownload(url: string) {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/')) {
    throw new Error('Получен некорректный адрес скачивания.');
  }
  const anchor = document.createElement('a');
  anchor.href = target.href;
  anchor.setAttribute('download', '');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
