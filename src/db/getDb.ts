import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });

  if (!env.DB) {
    throw new Error("D1 database not configured");
  }

  return drizzle(env.DB, { schema });
}
