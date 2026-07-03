/**
 * Prisma 7 configuration.
 *
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI (migrate,
 * db seed, introspect) reads the datasource URL from here. We load it from
 * `.env.local` (Next.js convention) with a fallback to `.env`, so the same
 * variable serves both Next.js and Prisma. The runtime client receives a
 * driver adapter instead (see prisma/seed.ts and the slice-09 data layer).
 */

import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";

// Load .env.local first (its values win — dotenv does not override by default),
// then .env. Missing files are a no-op, so `prisma generate` works with no env.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrations prefer a DIRECT (unpooled) connection — Neon's pooled
    // "-pooler" host can fail migrate on advisory locks. Falls back to
    // DATABASE_URL when DIRECT_URL is unset (fine if that URL is already direct).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx lib/db/seed.ts",
  },
});
