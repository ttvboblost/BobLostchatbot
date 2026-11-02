import { Router, type IRouter, type Response } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { authorizedGroupsTable, db } from "@workspace/db";

const router: IRouter = Router();
const groupParamsSchema = z.object({
  groupId: z.string().regex(/^[0-9a-zA-Z:_-]{6,128}@g\.us$/),
});

router.get("/groups", async (_req, res): Promise<void> => {
  const groups = await db
    .select()
    .from(authorizedGroupsTable)
    .orderBy(asc(authorizedGroupsTable.groupName));
  res.json({ success: true, data: groups });
});

router.post("/groups/:groupId/authorize", async (req, res): Promise<void> => {
  await setGroupAuthorization(req.params, true, res);
});

router.post("/groups/:groupId/block", async (req, res): Promise<void> => {
  await setGroupAuthorization(req.params, false, res);
});

async function setGroupAuthorization(
  rawParams: unknown,
  isAuthorized: boolean,
  res: Response,
): Promise<void> {
  const params = groupParamsSchema.safeParse(rawParams);
  if (!params.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_GROUP_ID", message: "Identificador do grupo inválido." },
    });
    return;
  }

  const [group] = await db
    .update(authorizedGroupsTable)
    .set({ isAuthorized, updatedAt: new Date() })
    .where(eq(authorizedGroupsTable.groupId, params.data.groupId))
    .returning();
  if (!group) {
    res.status(404).json({
      success: false,
      error: { code: "GROUP_NOT_FOUND", message: "Grupo ainda não observado pelo bot." },
    });
    return;
  }
  res.json({ success: true, data: group });
}

export default router;
