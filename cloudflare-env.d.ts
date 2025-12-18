/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  SEARCH_CACHE: KVNamespace;
}

declare module "@opennextjs/cloudflare" {
  export function getCloudflareContext(options?: {
    async?: boolean;
  }): Promise<{ env: CloudflareEnv; ctx: ExecutionContext }>;
}
