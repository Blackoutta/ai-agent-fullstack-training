import assert from "node:assert/strict";
import test from "node:test";

import { isSessionExpired } from "../src/auth/session-policy.js";

const session = { expiresAt: "2026-09-11T00:30:00.000Z" };

test("到期前仍然有效", () => {
  const now = new Date("2026-09-11T00:29:59.999Z");
  assert.equal(isSessionExpired(session, now), false);
});

test("到期时刻视为已过期", () => {
  const now = new Date("2026-09-11T00:30:00.000Z");
  assert.equal(isSessionExpired(session, now), true);
});

test("到期后立即失效", () => {
  const now = new Date("2026-09-11T00:30:00.001Z");
  assert.equal(isSessionExpired(session, now), true);
});
