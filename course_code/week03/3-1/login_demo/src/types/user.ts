export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: "admin" | "member";
}

export interface LoginResult {
  accessToken: string;
  user: Pick<UserRecord, "id" | "email" | "displayName" | "role">;
}

export interface AuthTokenPayload {
  userId: string;
  role: UserRecord["role"];
}
