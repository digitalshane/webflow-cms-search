/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  DB: D1Database;
}

declare module "@opennextjs/cloudflare" {
  export function getCloudflareContext(options?: {
    async?: boolean;
  }): Promise<{ env: CloudflareEnv; ctx: ExecutionContext }>;
}
