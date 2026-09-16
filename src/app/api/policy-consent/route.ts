import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPrincipal } from "@/lib/authz";
import { CURRENT_POLICY_VERSION } from "@/lib/policy-consent";

/**
 * Records the signed-in user's agreement to the current privacy policy and
 * terms. Required by YouTube Developer Policy III.A.2.
 *
 * The version is taken from the server constant, never from the request, so a
 * crafted call cannot mark a user as having accepted a policy version that
 * does not exist.
 */
export async function POST() {
  const principal = await getPrincipal();
  if (!principal) {
    return NextResponse.json(
      { error: { message: "You must be signed in." } },
      { status: 401 },
    );
  }

  await db.user.update({
    where: { id: principal.id },
    data: {
      policyAcceptedAt: new Date(),
      policyAcceptedVersion: CURRENT_POLICY_VERSION,
    },
  });

  return NextResponse.json({ ok: true });
}
