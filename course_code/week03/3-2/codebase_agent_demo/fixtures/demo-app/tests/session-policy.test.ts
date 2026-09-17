import assert from "node:assert/strict";
import test from "node:test";

import { isSessionExpired } from "../src/auth/session-policy.js";

test("会话在过期时刻之后立即失效", () => {
  const session = { expiresAt: "2026-09-11T00:30:00.000Z" };
  const now = new Date("2026-09-11T00:45:00.000Z");

  assert.equal(isSessionExpired(session, now), true);
});

test("会话在过期时刻之前仍然有效", () => {
  const session = { expiresAt: "2026-09-11T00:30:00.000Z" };
  const now = new Date("2026-09-11T00:15:00.000Z");

  assert.equal(isSessionExpired(session, now), false);
});
