import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/authz";

/**
 * Entry point. Sends signed-in users to their dashboard and everyone else to
 * sign-in, so there is no ambiguous landing state.
 */
export default async function RootPage() {
  const principal = await getPrincipal();
  redirect(principal ? "/dashboard" : "/signin");
}
