import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

const adminToken = process.env["ADMIN_TOKEN"] ?? "";
const integrationEnabled = Boolean(
  process.env["DATABASE_URL"] &&
    adminToken.length >= 32 &&
    (process.env["SESSION_SECRET"]?.length ?? 0) >= 32,
);
let server: Server | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

test(
  "admin login and command CRUD use the persistent PostgreSQL database",
  { skip: !integrationEnabled },
  async () => {
    const [{ default: app }, database, { eq, inArray }] = await Promise.all([
      import("../app.js"),
      import("@workspace/db"),
      import("drizzle-orm"),
    ]);
    const { adminAuditLogsTable, commandsTable, db, pool } = database;
    closeDatabase = () => pool.end();
    const commandName = `it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const renamedCommand = `edit_${commandName.slice(3)}`;
    let commandId: string | null = null;
    let primaryError: unknown;

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const apiBase = `http://127.0.0.1:${address.port}/api`;

    try {
      const anonymousResponse = await fetch(`${apiBase}/admin/commands`);
      assert.equal(anonymousResponse.status, 401);

      const invalidLogin = await fetch(`${apiBase}/admin/session/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "invalid-token" }),
      });
      assert.equal(invalidLogin.status, 401);

      const login = await fetch(`${apiBase}/admin/session/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      });
      assert.equal(login.status, 200);
      const setCookie = login.headers.get("set-cookie");
      assert.ok(setCookie);
      const cookie = setCookie.split(";")[0];
      assert.ok(cookie?.startsWith("boblost_admin_session="));

      const session = await fetch(`${apiBase}/admin/session`, {
        headers: { cookie: cookie ?? "" },
      });
      assert.equal(session.status, 200);
      const sessionBody = (await session.json()) as {
        data: { authenticated: boolean; expiresAt: string | null };
      };
      assert.equal(sessionBody.data.authenticated, true);
      assert.ok(sessionBody.data.expiresAt);

      const create = await fetch(`${apiBase}/admin/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookie ?? "",
        },
        body: JSON.stringify({
          name: `!${commandName}`,
          description: "Temporary PostgreSQL integration check",
          responseContent: "Olá {nome} em {grupo}",
        }),
      });
      assert.equal(create.status, 201);
      const createdBody = (await create.json()) as {
        data: { id: string; name: string; isActive: boolean };
      };
      commandId = createdBody.data.id;
      assert.equal(createdBody.data.name, commandName);
      assert.equal(createdBody.data.isActive, true);

      const persisted = await db
        .select({ id: commandsTable.id })
        .from(commandsTable)
        .where(eq(commandsTable.id, commandId));
      assert.equal(persisted.length, 1);

      const duplicate = await fetch(`${apiBase}/admin/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookie ?? "",
        },
        body: JSON.stringify({
          name: commandName,
          description: "Duplicate normalized name",
          responseContent: "Must not be created",
        }),
      });
      assert.equal(duplicate.status, 409);

      const update = await fetch(`${apiBase}/admin/commands/${commandId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: cookie ?? "",
        },
        body: JSON.stringify({
          name: renamedCommand,
          description: "Updated integration command",
          responseContent: "Atualizado {nome}",
        }),
      });
      assert.equal(update.status, 200);
      const updatedBody = (await update.json()) as {
        data: { id: string; name: string; responseContent: string };
      };
      assert.equal(updatedBody.data.name, renamedCommand);
      assert.equal(updatedBody.data.responseContent, "Atualizado {nome}");

      const deactivate = await fetch(
        `${apiBase}/admin/commands/${commandId}/deactivate`,
        { method: "POST", headers: { cookie: cookie ?? "" } },
      );
      assert.equal(deactivate.status, 200);
      const inactiveBody = (await deactivate.json()) as {
        data: { isActive: boolean };
      };
      assert.equal(inactiveBody.data.isActive, false);

      const activate = await fetch(
        `${apiBase}/admin/commands/${commandId}/activate`,
        { method: "POST", headers: { cookie: cookie ?? "" } },
      );
      assert.equal(activate.status, 200);
      const activeBody = (await activate.json()) as {
        data: { isActive: boolean };
      };
      assert.equal(activeBody.data.isActive, true);

      const auditRows = await db
        .select({ action: adminAuditLogsTable.action })
        .from(adminAuditLogsTable)
        .where(eq(adminAuditLogsTable.resourceId, commandId));
      for (const action of [
        "command.create",
        "command.update",
        "command.deactivate",
        "command.activate",
      ]) {
        assert.ok(auditRows.some((row) => row.action === action));
      }

      const remove = await fetch(`${apiBase}/admin/commands/${commandId}`, {
        method: "DELETE",
        headers: { cookie: cookie ?? "" },
      });
      assert.equal(remove.status, 200);
      const remaining = await db
        .select({ id: commandsTable.id })
        .from(commandsTable)
        .where(eq(commandsTable.id, commandId));
      assert.equal(remaining.length, 0);

      const logout = await fetch(`${apiBase}/admin/session/logout`, {
        method: "POST",
        headers: { cookie: cookie ?? "" },
      });
      assert.equal(logout.status, 200);
      const clearedCookie = logout.headers.get("set-cookie")?.split(";")[0];
      assert.ok(clearedCookie?.startsWith("boblost_admin_session="));
      const afterLogout = await fetch(`${apiBase}/admin/commands`, {
        headers: { cookie: clearedCookie },
      });
      assert.equal(afterLogout.status, 401);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await db
          .delete(adminAuditLogsTable)
          .where(eq(adminAuditLogsTable.resourceId, commandId ?? ""));
        await db
          .delete(commandsTable)
          .where(inArray(commandsTable.name, [commandName, renamedCommand]));
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
      await new Promise<void>((resolve) => {
        if (!server?.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      server = undefined;
    }
  },
);

after(async () => {
  await closeDatabase?.();
});
