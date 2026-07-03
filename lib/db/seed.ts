/**
 * Database seed (slice 09).
 *
 * Idempotent baseline for the Postgres-backed app: one current season and a
 * ~26-person engineering roster with craig.f@getklar.com as the admin.
 *
 *   npm run db:seed     (also runs automatically after `npm run db:migrate`)
 *
 * Idempotent: players upsert by their unique email; the current season is
 * created only when none is marked current. Run with USE_MOCK irrelevant —
 * this always talks to DATABASE_URL via the Prisma client.
 */

import { config as loadEnv } from "dotenv";

// Load .env.local (Next.js convention) then .env before the client reads
// DATABASE_URL. Missing files are a no-op.
loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const EMAIL_DOMAIN = "getklar.com";
const email = (handle: string): string => `${handle}@${EMAIL_DOMAIN}`;

const ADMIN_EMAIL = email("craig.f");

type SeedPlayer = { email: string; name: string; isAdmin: boolean };

/** The admin plus a 25-strong engineering roster (26 total). */
const ROSTER: SeedPlayer[] = [
  { email: ADMIN_EMAIL, name: "Craig F", isAdmin: true },
  ...[
    "Ada Lovelace",
    "Linus Bytes",
    "Grace Hopper",
    "Dennis Ritchie",
    "Margaret Hamilton",
    "Alan Turing",
    "Barbara Liskov",
    "Ken Thompson",
    "Katherine Johnson",
    "Edsger Dijkstra",
    "Radia Perlman",
    "Tim Berners-Lee",
    "Karen Sparck Jones",
    "Donald Knuth",
    "Frances Allen",
    "Brian Kernighan",
    "Shafi Goldwasser",
    "Vint Cerf",
    "Joan Clarke",
    "Guido Rossum",
    "Anita Borg",
    "Bjarne Stroustrup",
    "Carla Meninsky",
    "Leslie Lamport",
    "Sophie Wilson",
  ].map((name) => ({
    // Handle: first name, lowercased (sufficient for distinct seed emails).
    email: email(name.split(" ")[0].toLowerCase()),
    name,
    isAdmin: false,
  })),
];

/** The current quarterly season window (indicative dates). */
const CURRENT_SEASON = {
  name: "2026 Q3",
  startsOn: new Date("2026-07-01T00:00:00.000Z"),
  endsOn: new Date("2026-09-30T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const prisma = getPrisma();

  try {
    // --- Roster: upsert by unique email (replace-semantics on update) ---
    for (const player of ROSTER) {
      await prisma.player.upsert({
        where: { email: player.email },
        update: { name: player.name, isAdmin: player.isAdmin, active: true },
        create: player,
      });
    }

    // --- Current season: create only if none is current ----------------
    const current = await prisma.season.findFirst({ where: { isCurrent: true } });
    if (!current) {
      await prisma.season.create({
        data: { ...CURRENT_SEASON, isCurrent: true },
      });
    }

    const [players, admins] = await Promise.all([
      prisma.player.count(),
      prisma.player.count({ where: { isAdmin: true } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(
      `Seed complete: ${players} players (${admins} admin), current season "${CURRENT_SEASON.name}".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
