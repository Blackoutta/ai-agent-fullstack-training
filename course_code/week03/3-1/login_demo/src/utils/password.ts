// Demo-only password check: the stored hash is "hash:" + plain text password.
export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string
): Promise<boolean> {
  return passwordHash === `hash:${plainTextPassword}`;
}
