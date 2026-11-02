export function bytes(value: number, digits = 1) {
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: index ? digits : 0 }).format(value / 1024 ** index)} ${units[index]}`;
}

export const integer = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
export function date(value: number) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value * 1000));
}

export function basename(name: string) { return name.split(/[\\/]/).pop() || name; }
export function parentPath(name: string) { const base = basename(name); return name.slice(0, name.length - base.length); }
export function gameColor(id: number) { return ['blue', 'violet', 'green', 'orange', 'pink'][id % 5]; }
