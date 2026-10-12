import express from "express";
import { loginRouter } from "./routes/login";
import { profileRouter } from "./routes/profile";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use("/api", loginRouter);
  app.use("/api", profileRouter);

  app.get("/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  return app;
}
