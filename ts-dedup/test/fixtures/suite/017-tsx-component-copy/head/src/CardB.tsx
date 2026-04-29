export function CardB({ title, body }: { title: string; body: string }) {
  if (title.length === 0) return <div />;
  const header = <h1>{title}</h1>;
  const content = <p>{body}</p>;
  return <div className="card">{header}{content}</div>;
}
