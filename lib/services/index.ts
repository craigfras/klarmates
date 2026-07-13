/**
 * Service selection: the app talks to `gameService`, which is the in-memory
 * mock by default and the Postgres-backed implementation when USE_MOCK=false.
 */
import { mockGameService } from "@/lib/services/gameService";
import { dbGameService } from "@/lib/services/dbGameService";
import { shouldUseMock } from "@/lib/services/selectService";
import type { GameService } from "@/lib/services/gameService";

export const gameService: GameService = shouldUseMock(process.env.USE_MOCK)
  ? mockGameService
  : dbGameService;

// NOTE: answer-draft persistence (answerDraftStore) is intentionally NOT
// re-exported here. This barrel eagerly binds `dbGameService`, which pulls in
// Prisma/pg/Slack; importing it from a "use client" view would drag that
// server-only code into the client bundle. Client views must import the draft
// store directly from "@/lib/services/answerDraftStore".
