import { Router } from "express";
import { authService } from "../services/auth-service";

export const loginRouter = Router();

// Login entry point for the demo: POST /api/login
loginRouter.post("/login", async (request, response) => {
  const { email, password } = request.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    response.status(400).json({ error: "email and password are required" });
    return;
  }

  try {
    const result = await authService.login(email, password);
    response.status(200).json(result);
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Login failed"
    });
  }
});
