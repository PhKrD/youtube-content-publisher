import { handlers } from "@/lib/auth";

/**
 * Auth.js sign-in / callback / session endpoints.
 * Node runtime (not edge): the Prisma adapter needs a TCP database socket.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
