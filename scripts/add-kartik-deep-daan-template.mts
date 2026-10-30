/**
 * Creates the Kartik Deep Daan (Hindi + English) title and description templates
 * and ensures the KARTIK_DEEP_DAAN enum value exists in PostgreSQL.
 * Safe to re-run: updates or skips cleanly if they already exist.
 *
 * Usage:
 *   npx tsx scripts/add-kartik-deep-daan-template.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const TITLE_HI =
  "कार्तिक दीपदान सेवा – दिवस {{DAY_NUMBER}} | {{SPONSOR_NAME}} #kartikdeepdaan #deepdaan";

const BODY_HI = `🙏 हरे कृष्ण! 🙏

🪔 कार्तिक दीपदान सेवा – दिवस {{DAY_NUMBER}} - तारीख - {{DATE_HI_LONG}} 🪔

आज की दीपदान सेवा {{SPONSOR_NAME}} द्वारा प्रायोजित की गई है। 🙏

हम श्री श्री राधा-कृष्ण से प्रार्थना करते हैं कि वे प्रभुजी एवं उनके परिवार पर अपनी असीम कृपा बनाए रखें और श्रील प्रभुपाद जी का आशीर्वाद सदैव प्राप्त होता रहे। 🙏

🪷 हरे कृष्ण हरे कृष्ण, कृष्ण कृष्ण हरे हरे। हरे राम हरे राम, राम राम हरे हरे॥`;

const TITLE_EN =
  "Kartik Deep Daan Seva – Day {{DAY_NUMBER}} | {{SPONSOR_NAME}} #kartikdeepdaan #deepdaan";

const BODY_EN = `🙏 Hare Krishna! 🙏

🪔 Kartik Deep Daan Seva – Day {{DAY_NUMBER}} - Date - {{DATE}} 🪔

Today's Deep Daan Seva has been sponsored by {{SPONSOR_NAME}}. 🙏

We pray to Sri Sri Radha-Krishna to bestow Their boundless mercy upon Prabhuji and his family, and may the blessings of Srila Prabhupada always remain with them. 🙏

🪷 Hare Krishna Hare Krishna, Krishna Krishna Hare Hare. Hare Rama Hare Rama, Rama Rama Hare Hare.`;

type Var = { key: string; label: string; helpText: string; sortOrder: number };

const DAY_HI: Var = {
  key: "DAY_NUMBER",
  label: "Day number (दिवस)",
  helpText: "e.g. 1, 2, 3 (या १, २, ३)",
  sortOrder: 0,
};

const SPONSOR_HI: Var = {
  key: "SPONSOR_NAME",
  label: "Sponsor name (प्रायोजक का नाम)",
  helpText: "e.g. विनोद वाणी प्रभुजी",
  sortOrder: 2,
};

const TITLE_VARS_HI: Var[] = [DAY_HI, SPONSOR_HI];
const DESCRIPTION_VARS_HI: Var[] = [
  DAY_HI,
  {
    key: "DATE_HI_LONG",
    label: "Date (तारीख)",
    helpText: "Pick the date above (e.g. १ नवंबर २०२६).",
    sortOrder: 1,
  },
  SPONSOR_HI,
];

const DAY_EN: Var = {
  key: "DAY_NUMBER",
  label: "Day number",
  helpText: "e.g. 1, 2, 3",
  sortOrder: 0,
};

const SPONSOR_EN: Var = {
  key: "SPONSOR_NAME",
  label: "Sponsor name",
  helpText: "e.g. Vinod Vani Prabhuji",
  sortOrder: 2,
};

const TITLE_VARS_EN: Var[] = [DAY_EN, SPONSOR_EN];
const DESCRIPTION_VARS_EN: Var[] = [
  DAY_EN,
  {
    key: "DATE",
    label: "Date",
    helpText: "Pick the date above (e.g. 1 November 2026).",
    sortOrder: 1,
  },
  SPONSOR_EN,
];

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});
await client.connect();

try {
  await client.query(`ALTER TYPE "Program" ADD VALUE IF NOT EXISTS 'KARTIK_DEEP_DAAN'`);

  const orgs = await client.query(`SELECT id, name FROM "Organization"`);
  if (orgs.rows.length !== 1) {
    throw new Error(`Expected one organisation, found ${orgs.rows.length}.`);
  }
  const orgId: string = orgs.rows[0].id;

  await client.query("BEGIN");

  const upsertVar = (column: string, templateId: string, v: Var) =>
    client.query(
      `INSERT INTO "TemplateVariable" (id, "${column}", key, label, "helpText", "inputType", required, "isLocked", "sortOrder", "updatedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, 'TEXT', true, false, $6, now(), now())
       ON CONFLICT ("${column}", key) DO UPDATE SET
         label = EXCLUDED.label,
         "helpText" = EXCLUDED."helpText",
         "sortOrder" = EXCLUDED."sortOrder",
         "updatedAt" = now()`,
      [randomUUID(), templateId, v.key, v.label, v.helpText, v.sortOrder],
    );

  // 1. Hindi (HI) Templates
  const existingHiTitle = await client.query(
    `SELECT id FROM "TitleTemplate" WHERE "organizationId" = $1 AND program = 'KARTIK_DEEP_DAAN' AND language = 'HI' LIMIT 1`,
    [orgId],
  );
  const existingHiDesc = await client.query(
    `SELECT id FROM "DescriptionTemplate" WHERE "organizationId" = $1 AND program = 'KARTIK_DEEP_DAAN' AND language = 'HI' LIMIT 1`,
    [orgId],
  );

  const hiTitleId: string = existingHiTitle.rows[0]?.id ?? randomUUID();
  const hiDescId: string = existingHiDesc.rows[0]?.id ?? randomUUID();

  await client.query(
    `INSERT INTO "TitleTemplate" (id, "organizationId", name, pattern, "maxLength", "isDefault", "isActive", program, language, "updatedAt", "createdAt")
     VALUES ($1, $2, 'Kartik Deep Daan (Hindi)', $3, 100, false, true, 'KARTIK_DEEP_DAAN', 'HI', now(), now())
     ON CONFLICT (id) DO UPDATE SET pattern = EXCLUDED.pattern, "updatedAt" = now()`,
    [hiTitleId, orgId, TITLE_HI],
  );

  await client.query(
    `INSERT INTO "DescriptionTemplate" (id, "organizationId", name, body, "isDefault", "isActive", program, language, "updatedAt", "createdAt")
     VALUES ($1, $2, 'Kartik Deep Daan (Hindi)', $3, false, true, 'KARTIK_DEEP_DAAN', 'HI', now(), now())
     ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, "updatedAt" = now()`,
    [hiDescId, orgId, BODY_HI],
  );

  for (const v of TITLE_VARS_HI) await upsertVar("titleTemplateId", hiTitleId, v);
  for (const v of DESCRIPTION_VARS_HI) await upsertVar("descriptionTemplateId", hiDescId, v);

  // 2. English (EN) Templates
  const existingEnTitle = await client.query(
    `SELECT id FROM "TitleTemplate" WHERE "organizationId" = $1 AND program = 'KARTIK_DEEP_DAAN' AND language = 'EN' LIMIT 1`,
    [orgId],
  );
  const existingEnDesc = await client.query(
    `SELECT id FROM "DescriptionTemplate" WHERE "organizationId" = $1 AND program = 'KARTIK_DEEP_DAAN' AND language = 'EN' LIMIT 1`,
    [orgId],
  );

  const enTitleId: string = existingEnTitle.rows[0]?.id ?? randomUUID();
  const enDescId: string = existingEnDesc.rows[0]?.id ?? randomUUID();

  await client.query(
    `INSERT INTO "TitleTemplate" (id, "organizationId", name, pattern, "maxLength", "isDefault", "isActive", program, language, "updatedAt", "createdAt")
     VALUES ($1, $2, 'Kartik Deep Daan (English)', $3, 100, false, true, 'KARTIK_DEEP_DAAN', 'EN', now(), now())
     ON CONFLICT (id) DO UPDATE SET pattern = EXCLUDED.pattern, "updatedAt" = now()`,
    [enTitleId, orgId, TITLE_EN],
  );

  await client.query(
    `INSERT INTO "DescriptionTemplate" (id, "organizationId", name, body, "isDefault", "isActive", program, language, "updatedAt", "createdAt")
     VALUES ($1, $2, 'Kartik Deep Daan (English)', $3, false, true, 'KARTIK_DEEP_DAAN', 'EN', now(), now())
     ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, "updatedAt" = now()`,
    [enDescId, orgId, BODY_EN],
  );

  for (const v of TITLE_VARS_EN) await upsertVar("titleTemplateId", enTitleId, v);
  for (const v of DESCRIPTION_VARS_EN) await upsertVar("descriptionTemplateId", enDescId, v);

  await client.query("COMMIT");
  console.log("Created/updated Kartik Deep Daan (Hindi & English) templates.");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end();
}
