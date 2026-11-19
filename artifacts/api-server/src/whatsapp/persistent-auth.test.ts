import assert from "node:assert/strict";
import { test } from "node:test";
import { withAuthStoreRetry } from "./persistent-auth.js";

test("retries transient PostgreSQL connection failures before returning", async () => {
  let attempts = 0;
  const result = await withAuthStoreRetry("test_read", async () => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(
        new Error("Connection terminated due to connection timeout"),
        { code: "ETIMEDOUT" },
      );
    }
    return "loaded";
  });

  assert.equal(result, "loaded");
  assert.equal(attempts, 3);
});

test("does not retry permanent authentication-store errors", async () => {
  const permissionError = Object.assign(new Error("permission denied"), {
    code: "42501",
  });
  let attempts = 0;

  await assert.rejects(
    withAuthStoreRetry("test_write", async () => {
      attempts += 1;
      throw permissionError;
    }),
    (error) => error === permissionError,
  );
  assert.equal(attempts, 1);
});
