import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { commandLogsTable, db } from "@workspace/db";

const router: IRouter = Router();

const querySchema = z.object({
  groupId: z.string().regex(/^[0-9a-zA-Z:_-]{6,128}@g\.us$/).optional(),
  commandName: z.string().min(1).max(32).optional(),
  status: z.string().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
  after: z.coerce.date().optional(),
});

router.get("/command-logs", async (req, res): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_FILTER", message: "Filtros do histórico inválidos." },
    });
    return;
  }

  const filters = [];
  if (parsed.data.groupId) {
    filters.push(eq(commandLogsTable.groupId, parsed.data.groupId));
  }
  if (parsed.data.commandName) {
    filters.push(eq(commandLogsTable.commandName, parsed.data.commandName));
  }
  if (parsed.data.status) {
    filters.push(eq(commandLogsTable.status, parsed.data.status));
  }
  if (parsed.data.after) {
    filters.push(gte(commandLogsTable.createdAt, parsed.data.after));
  }
  if (parsed.data.before) {
    filters.push(lte(commandLogsTable.createdAt, parsed.data.before));
  }

  const logs = await db
    .select()
    .from(commandLogsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(commandLogsTable.createdAt))
    .limit(parsed.data.limit);
  res.json({ success: true, data: logs });
});

export default router;
