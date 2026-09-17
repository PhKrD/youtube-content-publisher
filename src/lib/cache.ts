import { db } from "./db";
import { unstable_cache } from "next/cache";

/**
 * Cache playlist lookups for 5 minutes since they change infrequently.
 * This reduces database queries on dashboard and content editor pages.
 */
export async function getCachedPlaylists(organizationId: string) {
  return unstable_cache(
    async () => {
      return db.playlist.findMany({
        where: { organizationId },
        orderBy: [{ isDefault: "desc" }, { title: "asc" }],
        select: { id: true, title: true, isAllowed: true },
      });
    },
    [`playlists-${organizationId}`],
    { revalidate: 300, tags: ["playlists"] }
  )();
}

/**
 * Cache tag group lookups for 5 minutes since they change infrequently.
 * This reduces database queries on content editor pages.
 */
export async function getCachedTagGroups(organizationId: string) {
  return unstable_cache(
    async () => {
      return db.tagGroup.findMany({
        where: { organizationId, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, tags: true, isMandatory: true },
      });
    },
    [`taggroups-${organizationId}`],
    { revalidate: 300, tags: ["taggroups"] }
  )();
}

/**
 * Cache organization settings for 1 minute.
 * This reduces database queries on dashboard and settings pages.
 */
export async function getCachedOrganization(organizationId: string) {
  return unstable_cache(
    async () => {
      return db.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          productionPublishingEnabled: true,
          setupCompletedAt: true,
          approvalMode: true,
        },
      });
    },
    [`org-${organizationId}`],
    { revalidate: 60, tags: ["organization"] }
  )();
}
