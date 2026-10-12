import assert from "node:assert/strict";
import test from "node:test";

import { loginRoute } from "../src/routes/login.js";

test("登录成功后返回会话令牌", async () => {
  const result = await loginRoute({
    email: "alice@example.com",
    password: "secret-123",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.sessionToken, "session-user-1001");
});

test("密码错误时登录失败", async () => {
  await assert.rejects(
    () => loginRoute({ email: "alice@example.com", password: "wrong" }),
    /INVALID_PASSWORD/,
  );
});
