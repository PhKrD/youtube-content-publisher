import { cache } from "react";
import { db } from "./db";
import {
  DEFAULT_POST_TEMPLATE,
  postTemplateSchema,
  resolveContentFields,
  type ContentFieldsConfig,
} from "./content-fields";

/** Keys in the `Setting` table. */
export const SETTING_KEYS = {
  contentFields: "contentFields",
  postTemplate: "postTemplate",
} as const;

/** Both org-level editor settings in one query, memoised per request. */
export const getEditorSettings = cache(
  async (
    organizationId: string,
  ): Promise<{ contentFields: ContentFieldsConfig; postTemplate: string }> => {
    const rows = await db.setting.findMany({
      where: {
        organizationId,
        key: { in: [SETTING_KEYS.contentFields, SETTING_KEYS.postTemplate] },
      },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const post = postTemplateSchema.safeParse(byKey.get(SETTING_KEYS.postTemplate));
    return {
      contentFields: resolveContentFields(byKey.get(SETTING_KEYS.contentFields)),
      postTemplate: post.success ? post.data : DEFAULT_POST_TEMPLATE,
    };
  },
);
