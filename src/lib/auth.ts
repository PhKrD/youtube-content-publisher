import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "./db";
import { env } from "./env";
import { hashToken } from "./crypto";
import { logger } from "./logger";
import { Role } from "@/generated/prisma";

/**
 * User sign-in (identity only).
 *
 * This is deliberately NOT the same thing as the Google account used to
 * publish. Signing in requests the minimum possible scopes — `openid email
 * profile`. The broad `youtube.upload` / `drive.file` scopes are requested
 * once, from one administrator, in the separate flow under
 * /api/integrations/google. Asking every student for upload permission on the
 * organisation's channel would be both a consent-screen nightmare and a
 * least-privilege violation.
 *
 * Access is allow-listed: a Google account can only sign in if an admin has
 * invited that email address, or if it matches BOOTSTRAP_ADMIN_EMAIL during
 * first-time setup. Otherwise anyone on the internet with a Google account
 * would have an account here.
 *
 * Sessions are stored in the database rather than in a JWT, so that disabling
 * a user takes effect immediately instead of whenever their token happens to
 * expire.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string | null;
      canPublishDirectly: boolean;
    } & DefaultSession["user"];
  }
}

/** Case-insensitive, trimmed comparison for email allow-listing. */
function normaliseEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function bootstrapAdminEmail(): string {
  try {
    return normaliseEmail(env.BOOTSTRAP_ADMIN_EMAIL);
  } catch {
    return "";
  }
}

/** A pending, unexpired, unrevoked invitation for this address. */
async function findUsableInvite(email: string) {
  return db.invite.findFirst({
    where: {
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),

  session: {
    strategy: "database",
    maxAge: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh at most daily
  },

  pages: {
    signIn: "/signin",
    error: "/signin",
  },

  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // Identity only. No Drive/YouTube scopes here, on purpose.
          scope: "openid email profile",
          prompt: "select_account",
        },
      },
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  callbacks: {
    /**
     * The access gate. Runs before the adapter persists anything, so an
     * uninvited account is never even created.
     */
    async signIn({ user, profile }) {
      const email = normaliseEmail(user.email ?? profile?.email);
      if (!email) {
        logger.warn("sign-in denied: google returned no email");
        return false;
      }

      // Google tells us whether it has verified ownership of the address.
      // Without this check, an unverified address could be used to claim an
      // invitation belonging to someone else.
      if (profile && profile.email_verified === false) {
        logger.warn("sign-in denied: unverified google email", { email });
        return false;
      }

      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true, disabledAt: true },
      });

      if (existing) {
        if (existing.disabledAt) {
          logger.warn("sign-in denied: account disabled", { userId: existing.id });
          return false;
        }
        return true;
      }

      if (email === bootstrapAdminEmail()) return true;
      if (await findUsableInvite(email)) return true;

      logger.warn("sign-in denied: no invitation", { email });
      return false;
    },

    /**
     * Attaches authorisation facts to the session. Read fresh from the
     * database on every request, so a role change or a disable takes effect
     * at once.
     */
    async session({ session, user }) {
      const record = await db.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          organizationId: true,
          canPublishDirectly: true,
          disabledAt: true,
        },
      });

      // Disabled mid-session: drop the privileges immediately. The
      // requireUser() helper turns this into a redirect.
      if (!record || record.disabledAt) {
        session.user = {
          ...session.user,
          id: user.id,
          role: Role.CONTRIBUTOR,
          organizationId: null,
          canPublishDirectly: false,
        };
        return session;
      }

      session.user = {
        ...session.user,
        id: record.id,
        role: record.role,
        organizationId: record.organizationId,
        canPublishDirectly: record.canPublishDirectly,
      };
      return session;
    },
  },

  events: {
    /**
     * Assigns organisation and role exactly once, at account creation, by
     * consuming an invitation. Doing this here rather than in `signIn` means
     * the user row already exists and the whole thing is one transaction.
     */
    async createUser({ user }) {
      const email = normaliseEmail(user.email);
      if (!email || !user.id) return;

      const isBootstrap = email !== "" && email === bootstrapAdminEmail();

      if (isBootstrap) {
        // First administrator. Attach to the sole existing organization, or
        // create one if the seed has not been run.
        const org =
          (await db.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
          (await db.organization.create({
            data: { name: env.SEED_ORG_NAME, slug: env.SEED_ORG_SLUG },
          }));

        await db.user.update({
          where: { id: user.id },
          data: {
            organizationId: org.id,
            role: Role.ADMIN,
            canPublishDirectly: true,
            emailVerified: new Date(),
          },
        });
        logger.info("bootstrap administrator created", { userId: user.id, orgId: org.id });
        return;
      }

      const invite = await findUsableInvite(email);
      if (!invite) {
        // signIn already rejected this case; belt and braces.
        logger.warn("createUser with no invitation — leaving unassigned", { userId: user.id });
        return;
      }

      await db.$transaction([
        db.user.update({
          where: { id: user.id },
          data: {
            organizationId: invite.organizationId,
            role: invite.role,
            // Contributors do not get publish rights from an invitation;
            // an admin grants that explicitly afterwards.
            canPublishDirectly: invite.role === Role.ADMIN,
            emailVerified: new Date(),
          },
        }),
        db.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        }),
      ]);

      logger.info("invited user joined", {
        userId: user.id,
        orgId: invite.organizationId,
        role: invite.role,
      });
    },

    async signIn({ user }) {
      if (!user.id) return;
      await db.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => {
          /* last-login is telemetry; never block a sign-in over it */
        });
    },
  },

  // Auth.js emits its own diagnostics; route them through our redacting logger.
  logger: {
    error(error) {
      logger.error("auth error", { error });
    },
    warn(code) {
      logger.warn("auth warning", { code });
    },
  },

  trustHost: true,
});

/** Hashes a raw invite token for lookup. Re-exported for the invite routes. */
export { hashToken };
