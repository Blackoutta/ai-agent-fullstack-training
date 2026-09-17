import { Router } from "express";
import { authMiddleware } from "../middleware/auth-middleware";

export const profileRouter = Router();

profileRouter.get("/profile", authMiddleware, (request, response) => {
  response.status(200).json({
    message: "Authenticated request",
    currentUser: response.locals.currentUser
  });
});
