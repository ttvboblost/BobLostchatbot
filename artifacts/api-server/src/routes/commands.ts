import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { commandsTable, db } from "@workspace/db";
import { recordAdminAudit } from "../lib/admin-audit.js";

const router: IRouter = Router();

const commandNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^!/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/));

const createCommandSchema = z
  .object({
    name: commandNameSchema,
    description: z.string().trim().min(1).max(500),
    responseContent: z.string().trim().min(1).max(4000),
    isActive: z.boolean().optional(),
  })
  .strict();

const updateCommandSchema = z
  .object({
    name: commandNameSchema.optional(),
    description: z.string().trim().min(1).max(500).optional(),
    responseContent: z.string().trim().min(1).max(4000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const commandIdParamsSchema = z.object({
  id: z.string().uuid(),
});

router.get("/commands", async (_req, res): Promise<void> => {
  const commands = await db
    .select()
    .from(commandsTable)
    .orderBy(commandsTable.name);
  res.json({ success: true, data: commands });
});

router.post("/commands", async (req, res): Promise<void> => {
  const parsed = createCommandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_COMMAND", message: "Dados do comando inválidos." },
    });
    return;
  }

  const [command] = await db
    .insert(commandsTable)
    .values({
      ...parsed.data,
      isActive: parsed.data.isActive ?? true,
    })
    .onConflictDoNothing()
    .returning();

  if (!command) {
    res.status(409).json({
      success: false,
      error: { code: "COMMAND_EXISTS", message: "Já existe um comando com esse nome." },
    });
    return;
  }

  await recordAdminAudit({
    action: "command.create",
    resourceType: "command",
    resourceId: command.id,
    metadata: { name: command.name, isActive: command.isActive },
  });
  res.status(201).json({ success: true, data: command });
});

router.patch("/commands/:id", async (req, res): Promise<void> => {
  const params = commandIdParamsSchema.safeParse(req.params);
  const parsed = updateCommandSchema.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_COMMAND", message: "Dados do comando inválidos." },
    });
    return;
  }

  let command;
  try {
    [command] = await db
      .update(commandsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(commandsTable.id, params.data.id))
      .returning();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({
        success: false,
        error: {
          code: "COMMAND_EXISTS",
          message: "Já existe um comando com esse nome.",
        },
      });
      return;
    }
    throw error;
  }

  if (!command) {
    res.status(404).json({
      success: false,
      error: { code: "COMMAND_NOT_FOUND", message: "Comando não encontrado." },
    });
    return;
  }
  await recordAdminAudit({
    action: "command.update",
    resourceType: "command",
    resourceId: command.id,
    metadata: { changedFields: Object.keys(parsed.data) },
  });
  res.json({ success: true, data: command });
});

router.post("/commands/:id/activate", async (req, res): Promise<void> => {
  await setCommandActive(req.params, true, res);
});

router.post("/commands/:id/deactivate", async (req, res): Promise<void> => {
  await setCommandActive(req.params, false, res);
});

router.delete("/commands/:id", async (req, res): Promise<void> => {
  const params = commandIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_ID", message: "ID do comando inválido." },
    });
    return;
  }

  const [command] = await db
    .delete(commandsTable)
    .where(eq(commandsTable.id, params.data.id))
    .returning({ id: commandsTable.id });

  if (!command) {
    res.status(404).json({
      success: false,
      error: { code: "COMMAND_NOT_FOUND", message: "Comando não encontrado." },
    });
    return;
  }
  await recordAdminAudit({
    action: "command.delete",
    resourceType: "command",
    resourceId: command.id,
  });
  res.json({ success: true, data: { id: command.id, deleted: true } });
});

async function setCommandActive(
  rawParams: unknown,
  isActive: boolean,
  res: Response,
): Promise<void> {
  const params = commandIdParamsSchema.safeParse(rawParams);
  if (!params.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_ID", message: "ID do comando inválido." },
    });
    return;
  }

  const [command] = await db
    .update(commandsTable)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(commandsTable.id, params.data.id))
    .returning();
  if (!command) {
    res.status(404).json({
      success: false,
      error: { code: "COMMAND_NOT_FOUND", message: "Comando não encontrado." },
    });
    return;
  }
  await recordAdminAudit({
    action: isActive ? "command.activate" : "command.deactivate",
    resourceType: "command",
    resourceId: command.id,
    metadata: { name: command.name },
  });
  res.json({ success: true, data: command });
}

export default router;
