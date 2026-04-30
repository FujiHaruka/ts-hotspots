export function callB(id: number): string {
  const prefix = String(id);
  try {
    const res = runSync();
    return res.text;
  } catch (err) {
    return "err";
  }
  return prefix;
}

declare function runSync(): { text: string };
