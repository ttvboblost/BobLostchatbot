import { eq } from "drizzle-orm";
import { authorizedGroupsTable, db } from "@workspace/db";

export async function observeGroup(
  groupId: string,
  groupName: string | null,
): Promise<void> {
  await db
    .insert(authorizedGroupsTable)
    .values({ groupId, groupName, isAuthorized: false })
    .onConflictDoUpdate({
      target: authorizedGroupsTable.groupId,
      set: {
        ...(groupName ? { groupName } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function isGroupAuthorized(groupId: string): Promise<boolean> {
  const [group] = await db
    .select({ isAuthorized: authorizedGroupsTable.isAuthorized })
    .from(authorizedGroupsTable)
    .where(eq(authorizedGroupsTable.groupId, groupId))
    .limit(1);
  return group?.isAuthorized === true;
}
