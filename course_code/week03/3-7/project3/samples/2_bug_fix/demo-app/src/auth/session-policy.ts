export interface ExpiringSession {
  expiresAt: string;
}

export function isSessionExpired(session: ExpiringSession, now: Date): boolean {
  const expiresOn = session.expiresAt.slice(0, 10);
  const currentDay = now.toISOString().slice(0, 10);
  return expiresOn < currentDay;
}
