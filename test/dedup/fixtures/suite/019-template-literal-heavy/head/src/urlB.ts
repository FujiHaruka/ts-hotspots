export function buildUrlB(domain: string, route: string, key: number): string {
  const d = domain.replace(/\/$/, "");
  const r = route.startsWith("/") ? route : `/${route}`;
  const q = `?key=${String(key)}`;
  return `${d}${r}${q}`;
}
