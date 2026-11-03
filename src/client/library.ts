/** Accept a numeric AppID or a Steam store app URL, never arbitrary hosts or package IDs. */
export function parseAppId(value: string): number | null {
  const input = value.trim();
  let candidate = input;
  if (!/^\d+$/.test(input)) {
    try {
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.hostname !== 'store.steampowered.com' || url.username || url.password || url.port) return null;
      const match = /^\/app\/(\d+)(?:\/|$)/.exec(url.pathname);
      if (!match) return null;
      candidate = match[1];
    } catch { return null; }
  }
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 && id <= 0xffffffff ? id : null;
}

export function fileCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod100 >= 11 && mod100 <= 14 ? 'файлов' : mod10 === 1 ? 'файл' : mod10 >= 2 && mod10 <= 4 ? 'файла' : 'файлов';
  return `${count.toLocaleString('ru-RU')} ${word}`;
}
