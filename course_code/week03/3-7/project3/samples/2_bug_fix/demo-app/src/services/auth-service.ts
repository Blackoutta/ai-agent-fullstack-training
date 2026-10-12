const USERS = [
  {
    id: "user-1001",
    email: "alice@example.com",
    passwordHash: "hash:secret-123",
  },
];

export async function verifyPassword(email: string, password: string) {
  const user = USERS.find((item) => item.email === email);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const candidateHash = `hash:${password}`;
  if (candidateHash !== user.passwordHash) {
    throw new Error("INVALID_PASSWORD");
  }

  return {
    id: user.id,
    email: user.email,
  };
}
