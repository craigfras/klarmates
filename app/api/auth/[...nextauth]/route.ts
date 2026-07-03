/**
 * Auth.js v5 catch-all route handler (Node runtime).
 *
 * Delegates GET/POST to the `handlers` produced by the Node-side NextAuth
 * instance in `lib/auth.ts`, which is where the DB-touching callbacks live.
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
