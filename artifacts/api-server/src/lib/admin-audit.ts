import { adminAuditLogsTable, db } from "@workspace/db";

export async function recordAdminAudit(input: {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(adminAuditLogsTable).values({
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? {},
  });
}
