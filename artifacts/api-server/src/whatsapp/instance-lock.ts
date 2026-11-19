import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

const LOCK_NAMESPACE = 1_112_499_772;
const LOCK_RESOURCE = 1_464_346_945;

export function createWhatsAppInstanceLock(
  connect: () => Promise<PoolClient> = () => pool.connect(),
) {
  let owner: PoolClient | null = null;
  let acquiring: Promise<boolean> | null = null;

  return {
    isHeld(): boolean {
      return owner !== null;
    },

    acquire(): Promise<boolean> {
      if (owner) return Promise.resolve(true);
      if (acquiring) return acquiring;

      acquiring = (async () => {
        const client = await connect();
        try {
          const result = await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock($1, $2) AS locked",
            [LOCK_NAMESPACE, LOCK_RESOURCE],
          );
          if (result.rows[0]?.locked) {
            owner = client;
            return true;
          }
          client.release();
          return false;
        } catch (error) {
          client.release(error instanceof Error ? error : undefined);
          throw error;
        }
      })().finally(() => {
        acquiring = null;
      });
      return acquiring;
    },

    async check(): Promise<boolean> {
      if (!owner) return false;
      try {
        await owner.query("SELECT 1");
        return true;
      } catch (error) {
        const disconnectedOwner = owner;
        owner = null;
        disconnectedOwner.release(error instanceof Error ? error : undefined);
        return false;
      }
    },

    async release(): Promise<void> {
      const currentOwner = owner;
      owner = null;
      if (!currentOwner) return;

      try {
        await currentOwner.query(
          "SELECT pg_advisory_unlock($1, $2)",
          [LOCK_NAMESPACE, LOCK_RESOURCE],
        );
      } finally {
        currentOwner.release();
      }
    },
  };
}

export const whatsappInstanceLock = createWhatsAppInstanceLock();
