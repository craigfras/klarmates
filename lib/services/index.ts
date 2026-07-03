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
