import { Pool, types } from "pg";
import type { PostgresPool } from "kysely";
interface SharedPool {
  pool: Pool;
  references: number;
}
const pools = new Map<string, SharedPool>();
/** Two timestamp families share six connections, within the existing eight-connection service budget. */
export function vnextPool(
  connectionString: string,
  timestampsAsStrings = true,
): () => Promise<PostgresPool> {
  // Allocate on Kysely driver initialization, so unused scoped-command Owners never hold a lease.
  return async () => {
    const key = connectionString + "\0" + String(timestampsAsStrings);
    let shared = pools.get(key);
    if (!shared) {
      shared = {
        pool: new Pool({
          connectionString,
          max: 3,
          application_name: timestampsAsStrings
            ? "hdi-vnext-owners"
            : "hdi-vnext-catalog",
          options: "-c timezone=Asia/Shanghai",
          ...(timestampsAsStrings
            ? {
                types: {
                  getTypeParser: (oid: number, format?: "text" | "binary") =>
                    oid === 1114
                      ? (value: string) => value
                      : types.getTypeParser(oid, format),
                },
              }
            : {}),
        }),
        references: 0,
      };
      pools.set(key, shared);
    }
    shared.references++;
    const entry = shared;
    let closed = false;
    return {
      options: entry.pool.options,
      connect: () => {
        if (closed) throw new Error("DATABASE_OWNER_CLOSED");
        return entry.pool.connect();
      },
      async end() {
        if (closed) return;
        closed = true;
        entry.references--;
        if (entry.references === 0) {
          pools.delete(key);
          await entry.pool.end();
        }
      },
    };
  };
}
