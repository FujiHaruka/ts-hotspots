export function callA(): string {
  let out = "";
  try {
    const res = runSync();
    return res.text;
  } catch (err) {
    out = "fail";
  }
  return out;
}

declare function runSync(): { text: string };
