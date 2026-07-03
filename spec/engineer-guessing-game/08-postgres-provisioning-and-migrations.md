# 08 — Postgres Provisioning & Migrations

**Type:** HITL
**Depends on:** 04-scoring-leaderboard-recap

## What this delivers

A real managed Postgres database with the full schema migrated in, ready for the repository layer (slice 09) to use.

## Human action required (why it can't be automated)

- **Provision a managed Postgres instance** (Neon / Supabase / Vercel Postgres) and copy its connection string. This requires creating/owning a cloud account and accepting its billing — credentials cannot be generated from code.
- Set `DATABASE_URL` in `.env.local` (and later in Vercel, slice 15).

## Layers touched

- `prisma/schema.prisma` (or `lib/db/schema.ts` if Drizzle)
- `prisma/migrations/**`
- `.env.example`, `.env.local`
- `package.json` (migrate scripts)

## Tasks

### Schema (code — runnable once `DATABASE_URL` is set)
- [ ] Add Prisma; model all spec tables: `players`, `seasons`, `weeks`, `questions`, `week_participants`, `matchups`, `answers`, `answer_options`, `guesses`, `weekly_scores`. Mirror columns/enums from the spec data model.
- [ ] Add useful indexes/uniques: unique `players.email`; index `weekly_scores(season_id, player_id)`; a uniqueness guard for in-season pairs (e.g. unique on `(season_id, leastId, greatestId)` via a derived column or app-level check) to back the no-repeat rule.
- [ ] Add scripts: `db:migrate`, `db:generate`, `db:seed`.

### Human-gated
- [ ] Provision DB and set `DATABASE_URL` (see Human action).
- [ ] Run `npm run db:migrate` and confirm all tables exist.

## Verifiable outcome

- `npm run db:migrate` succeeds against the provisioned DB.
- All spec tables exist (verify via `\dt` / a DB GUI).
- `.env.example` documents `DATABASE_URL`; the app still builds.
