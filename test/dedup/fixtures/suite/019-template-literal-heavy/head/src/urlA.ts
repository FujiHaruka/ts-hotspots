export function buildUrlA(host: string, path: string, id: number): string {
  const h = host.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const query = `?id=${String(id)}`;
  return `${h}${p}${query}`;
}
