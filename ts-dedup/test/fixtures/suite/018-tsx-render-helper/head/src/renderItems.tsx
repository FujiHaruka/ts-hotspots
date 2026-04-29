export function renderItems(entries: string[]) {
  const children = entries.map((e) => <li key={e}>{e}</li>);
  return <ul className="list">{children}</ul>;
}
