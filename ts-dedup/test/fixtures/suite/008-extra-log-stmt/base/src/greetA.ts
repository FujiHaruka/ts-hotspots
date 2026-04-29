export function greet(name: string): string {
  if (name.length === 0) {
    return "anon";
  }
  const msg = `hello ${name}`;
  return msg;
}
