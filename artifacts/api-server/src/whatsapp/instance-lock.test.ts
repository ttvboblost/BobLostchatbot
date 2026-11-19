import assert from "node:assert/strict";
import { after, test } from "node:test";

const canRunDatabaseTest = Boolean(process.env["DATABASE_URL"]);
let closeDatabase: (() => Promise<void>) | undefined;

test(
  "only one process can hold the WhatsApp session advisory lock",
  { skip: !canRunDatabaseTest },
  async () => {
    const [{ pool }, { createWhatsAppInstanceLock }] = await Promise.all([
      import("@workspace/db"),
      import("./instance-lock.js"),
    ]);
    closeDatabase = () => pool.end();

    const first = createWhatsAppInstanceLock();
    const second = createWhatsAppInstanceLock();
    try {
      assert.equal(await first.acquire(), true);
      assert.equal(await first.check(), true);
      assert.equal(await second.acquire(), false);
      await first.release();
      assert.equal(await second.acquire(), true);
    } finally {
      await first.release();
      await second.release();
    }
  },
);

after(async () => {
  await closeDatabase?.();
});
