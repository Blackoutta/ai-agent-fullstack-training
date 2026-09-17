import { verifyPassword } from "../services/auth-service.js";
import { createSession } from "../auth/session.js";

export interface LoginPayload {
  email: string;
  password: string;
}

export async function loginRoute(payload: LoginPayload) {
  const user = await verifyPassword(payload.email, payload.password);
  const session = createSession(user.id);

  return {
    status: 200,
    body: {
      message: "login ok",
      sessionToken: session.token,
      userId: user.id,
    },
  };
}
