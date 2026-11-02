import assert from "node:assert/strict";
import { test } from "node:test";
import { isAdminTokenValid } from "./admin-auth.js";

test("accepts only the configured strong admin token", () => {
  const previous = process.env["ADMIN_TOKEN"];
  process.env["ADMIN_TOKEN"] = "a".repeat(40);
  try {
    assert.equal(isAdminTokenValid("a".repeat(40)), true);
    assert.equal(isAdminTokenValid("b".repeat(40)), false);
    assert.equal(isAdminTokenValid("a"), false);
  } finally {
    if (previous === undefined) delete process.env["ADMIN_TOKEN"];
    else process.env["ADMIN_TOKEN"] = previous;
  }
});

test("rejects an absent or weak configured token", () => {
  const previous = process.env["ADMIN_TOKEN"];
  delete process.env["ADMIN_TOKEN"];
  try {
    assert.equal(isAdminTokenValid("anything"), false);
    process.env["ADMIN_TOKEN"] = "short";
    assert.equal(isAdminTokenValid("short"), false);
  } finally {
    if (previous === undefined) delete process.env["ADMIN_TOKEN"];
    else process.env["ADMIN_TOKEN"] = previous;
  }
});
