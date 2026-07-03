/**
 * Prisma client singleton (Prisma 7 + pg driver adapter).
 *
 * Lazy on purpose: `getPrisma()` constructs the client on first call, not at
 * import time. That lets `dbGameService` be imported in mock mode (USE_MOCK
 * default) and during tests WITHOUT a DATABASE_URL — the client is only built
 * when a DB-backed method actually runs.
 *
 * The instance is cached on `globalThis` so Next.js dev hot-reloads and the
 * separate route-handler / server-component module bundles share one pool
 * (see the "Next.js module state not shared" note).
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ---------------------------------------------------------------------------
// Cache slot
// ---------------------------------------------------------------------------

const PRISMA_GLOBAL_KEY = "__eggPrisma__";

type GlobalWithPrisma = typeof globalThis & {
  [PRISMA_GLOBAL_KEY]?: PrismaClient;
};

// ---------------------------------------------------------------------------
// Factory + accessor
// ---------------------------------------------------------------------------

const createClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. It is required when USE_MOCK=false (the " +
        "Postgres-backed service). Set it in .env.local.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
};

/**
 * Returns the process-wide Prisma client, constructing it on first use.
 * Throws only when actually invoked without a DATABASE_URL.
 */
export const getPrisma = (): PrismaClient => {
  const g = globalThis as GlobalWithPrisma;
  if (g[PRISMA_GLOBAL_KEY] === undefined) {
    g[PRISMA_GLOBAL_KEY] = createClient();
  }
  return g[PRISMA_GLOBAL_KEY];
};
