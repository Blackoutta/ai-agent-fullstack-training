export function createSession(userId: string) {
  return {
    token: `session-${userId}`,
    userId,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}
