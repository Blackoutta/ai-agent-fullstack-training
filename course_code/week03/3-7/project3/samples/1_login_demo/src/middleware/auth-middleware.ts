import { NextFunction, Request, Response } from "express";
import { parseAccessToken } from "../utils/token";

export function authMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = authHeader.replace("Bearer ", "");
  const payload = parseAccessToken(token);

  if (!payload) {
    response.status(401).json({ error: "Invalid token" });
    return;
  }

  response.locals.currentUser = payload;
  next();
}
