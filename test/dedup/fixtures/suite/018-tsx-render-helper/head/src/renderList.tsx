export function renderList(items: string[]) {
  const children = items.map((it) => <li key={it}>{it}</li>);
  return <ul className="list">{children}</ul>;
}
