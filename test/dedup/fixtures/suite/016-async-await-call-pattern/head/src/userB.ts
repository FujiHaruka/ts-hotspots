declare const api: { get(key: string): Promise<string> };

export async function loadB(key: string): Promise<string> {
  const v = await api.get(key);
  if (v.length === 0) throw new Error("missing");
  return v.toUpperCase();
}
