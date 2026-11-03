export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") { super(message); }
}

export async function api<T>(path: string, options: { body?: unknown; csrf?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: options.body === undefined ? { 'Accept-Language': document.documentElement.lang || 'en' } : {
      'Accept-Language': document.documentElement.lang || 'en',
      'Content-Type': 'application/json',
      'x-csrf-token': options.csrf || '',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
    throw new ApiError(response.status, typeof message === 'string' ? message : `Request failed (${response.status}).`, typeof data?.error?.code === "string" ? data.error.code : "REQUEST_FAILED");
  }
  return data as T;
}

/** Never navigate to an arbitrary URL returned by a server response. */
export function checkedDownloadUrl(url: string): string {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || target.username || target.password || !target.pathname.startsWith('/api/')) {
    throw new ApiError(502, 'Invalid download address', 'DOWNLOAD_URL_UNSAFE');
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
      ? message : `Download failed (HTTP ${response.status}).`, typeof data?.error?.code === 'string' ? data.error.code : 'DOWNLOAD_REJECTED');
  }
  if (!response.body) throw new ApiError(502, 'Download stream unavailable', 'DOWNLOAD_STREAM_UNAVAILABLE');
  const writable = await handle.createWritable();
  try {
    await response.body.pipeTo(writable);
  } catch (error) {
    await writable.abort().catch(() => {});
    throw new ApiError(502, 'Download interrupted; incomplete file was not saved', 'DOWNLOAD_INTERRUPTED');
  }
}

/** The streaming QR request remains inside one Vercel Function invocation. */
export async function loginViaQr(
  csrf: string,
  onChallenge: (qr: {qrDataUrl:string;expiresAt:number}) => void,
): Promise<import('../shared/types').SessionInfo> {
  const response = await fetch('/api/auth/steam', {
    method: 'POST', credentials: 'same-origin',
    headers: {'X-CSRF-Token': csrf, Accept: 'text/event-stream'},
  });
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, 'Steam Guard connection failed', 'STEAM_AUTH_ERROR');
  }
  const reader = response.body.getReader();
  let pending = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new ApiError(401, 'Steam login was not completed', 'STEAM_AUTH_ERROR');
      pending += decoder.decode(next.value, {stream:true});
      if (pending.length > 32768) throw new ApiError(502, 'Invalid Steam QR response', 'STEAM_AUTH_ERROR');
      let index: number;
      while ((index = pending.indexOf('\n\n')) >= 0) {
        const item = pending.slice(0,index);
        pending = pending.slice(index+2);
        const type = /^event: ([a-z]+)$/m.exec(item)?.[1];
        const text = /^data: (.+)$/m.exec(item)?.[1];
        if (!type || !text) continue;
        const data: unknown = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new ApiError(502, 'Invalid Steam QR response', 'STEAM_AUTH_ERROR');
        const obj = data as Record<string,unknown>;
        if (type === 'qr') {
          if (typeof obj.qrDataUrl !== 'string' || !obj.qrDataUrl.startsWith('data:image/png;base64,') ||
            typeof obj.expiresAt !== 'number') throw new ApiError(502,'Invalid QR image','STEAM_AUTH_ERROR');
          onChallenge({qrDataUrl:obj.qrDataUrl,expiresAt:obj.expiresAt});
        } else if (type === 'authenticated') {
          if (typeof obj.ticket !== 'string') throw new ApiError(502,'Invalid Steam ticket','STEAM_AUTH_ERROR');
          return await api<import('../shared/types').SessionInfo>('/api/auth/exchange', {
            csrf, body: {ticket:obj.ticket},
          });
        } else if (type === 'expired' || type === 'error') {
          throw new ApiError(401,'Steam Guard QR was not confirmed','STEAM_AUTH_ERROR');
        }
      }
    }
  } finally { await reader.cancel().catch(()=>{}); }
}

/** In supported browsers save a POST streaming ZIP directly to the disk. */
export async function saveStreamedPost(
  url: string,
  payload: {names:string[];revision:string},
  csrf: string,
  handle: SaveFileHandle,
): Promise<void> {
  const response=await fetch(checkedDownloadUrl(url),{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify(payload),
  });
  if(!response.ok){
    const data=await response.json().catch(()=>null);
    throw new ApiError(response.status,data?.error?.message||'ZIP download failed',
      data?.error?.code||'DOWNLOAD_REJECTED');
  }
  if(!response.body)throw new ApiError(502,'Stream unavailable','DOWNLOAD_STREAM_UNAVAILABLE');
  const writable=await handle.createWritable();
  try{await response.body.pipeTo(writable);}
  catch{
    await writable.abort().catch(()=>{});
    throw new ApiError(502,'Download interrupted; incomplete ZIP discarded','DOWNLOAD_INTERRUPTED');
  }
}

/** Native browser submission avoids buffering a multi-GB ZIP in JavaScript. */
export function submitZipForm(
  url:string,payload:{names:string[];revision:string},csrf:string,
):void {
  const form=document.createElement('form');
  form.method='POST';
  form.action=checkedDownloadUrl(url);
  form.style.display='none';
  const input=(name:string,value:string)=>{
    const node=document.createElement('input');
    node.type='hidden';node.name=name;node.value=value;form.appendChild(node);
  };
  input('names',JSON.stringify(payload.names));
  input('revision',payload.revision);
  input('csrf',csrf);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
