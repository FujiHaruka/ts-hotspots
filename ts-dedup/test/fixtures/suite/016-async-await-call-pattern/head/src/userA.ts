declare const db: { find(id: string): Promise<string> };

export async function loadA(id: string): Promise<string> {
  const v = await db.find(id);
  if (v.length === 0) throw new Error("missing");
  return v.toUpperCase();
}
