import { AuthTokenPayload } from "../types/user";

export function issueAccessToken(payload: AuthTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `demo-token.${encoded}`;
}

export function parseAccessToken(token: string): AuthTokenPayload | null {
  if (!token.startsWith("demo-token.")) {
    return null;
  }

  const encoded = token.replace("demo-token.", "");

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as AuthTokenPayload;
  } catch {
    return null;
  }
}
