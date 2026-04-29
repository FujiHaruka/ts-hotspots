export function validateUser(user: { id: string; name: string }): boolean {
  if (!user.id) return false;
  return user.name.length >= 3;
}
