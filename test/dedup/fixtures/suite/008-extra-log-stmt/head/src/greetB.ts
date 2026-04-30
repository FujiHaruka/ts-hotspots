export function greet(name: string): string {
  if (name.length === 0) {
    return "anon";
  }
  console.log("greeting", name);
  const msg = `hello ${name}`;
  return msg;
}
