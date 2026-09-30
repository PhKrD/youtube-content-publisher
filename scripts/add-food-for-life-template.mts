/**
 * Creates (or brings up to date) the Food for Life Annadan title and
 * description templates. A "sponsored" checkbox switches the wording between
 * the sponsored and unsponsored versions, and shows the sponsor fields.
 * Safe to re-run.
 *
 *   npx tsx scripts/add-food-for-life-template.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const TITLE =
  "Food for Life Annadan | ISKCON Pune BCEC | {{DATE_SHORT}}{{#if IS_SPONSORED}} | Sponsored by {{SPONSOR_NAME}}{{/if}}";

const BODY = `{{#if IS_SPONSORED}}🍚 *Food for Life Annadan Seva | {{DATE_SHORT}}*

Today’s prasadam distribution has been sponsored by *{{SPONSOR_NAME}}*{{#if OCCASION_FOR}} {{OCCASION_TYPE}} *{{OCCASION_FOR}}*{{/if}}.

We pray to Sri Sri Nitai Gaurachandra and Srila Prabhupada that everyone who receives this prasadam is nourished, blessed, and drawn closer to Lord Sri Krishna. We are grateful to our sponsor for supporting this seva. 🙏{{else}}🍚 Food for Life Annadan Seva | {{DATE_SHORT}}

By the mercy of Sri Sri Nitai Gaurachandra and Srila Prabhupada, prasadam was distributed today through ISKCON Pune BCEC’s Food for Life Annadan Seva.

May everyone who receives this prasadam be nourished, blessed, and drawn closer to Lord Sri Krishna. Our heartfelt thanks to all the devotees and volunteers who served today. 🙏{{/if}}

Hare Krishna Hare Krishna, Krishna Krishna Hare Hare
Hare Rama Hare Rama, Rama Rama Hare Hare

To support Food for Life Annadan Seva or learn more, contact:
📞 9309471825
------------------------------------------------------------------------------------------------------------------------------------------------

Join our WhatsApp community to get regular updates on upcoming events
https://chat.whatsapp.com/HYaz0TjPbbQGykEmrgsMCu

Get Connected & Subscribe:
https://www.youtube.com/@iskconbcec

Connect with ISKCON BCEC's Food For Life program
http://iskconpunebcec.com/ffl

Visit our main website to know about upcoming events
http://iskconpunebcec.com/

Follow and subscribe to our Instagram Account
https://www.instagram.com/iskcon_bcec_pune/

Follow and subscribe to our Facebook Page
https://www.facebook.com/ISKCONPuneVishalNagar

Contact:
https://iskconpunebcec.com
Contact: +91 93094 71825
contact@iskconpunebcec.com

ISKCON Bhakti Center for Education and Culture (ISKCON BCEC)
ISKCON is a non-profit organization that works for social welfare. ISKCON has only one aim and that is spreading the values and teachings of our Vedas. ISKCON BCEC is a beautiful place for gaining such values and for making your life even more fruitful and meaningful. It is an unique Vedic and cultural Education Center. This center is determinedly trying to build up the spiritual and ethical fabric of society with the help of different cultural and spiritual educational programs.

Founder Acharya: Srila Prabhupada
His Divine Grace Srila Prabhupada is the founder acharya of ISKCON. On 17th September 1965, A.C. Bhaktivedanta Swami Srila Prabhupada entered the port of the New York City. His visit aimed to introduce a very old religion, which originated in India.`;

type Var = {
  key: string;
  label: string;
  helpText: string;
  sortOrder: number;
  required: boolean;
  inputType?: "TEXT" | "SELECT" | "CHECKBOX";
  options?: string[];
  defaultValue?: string;
};

// Filled from the date picker, shown as 12 Nov 2023.
const DATE: Var = {
  key: "DATE_SHORT",
  label: "Seva date",
  helpText: "The day the prasadam was distributed.",
  sortOrder: 0,
  required: true,
};
const SPONSORED: Var = {
  key: "IS_SPONSORED",
  label: "This seva was sponsored",
  helpText: "Tick to add the sponsor's details to the title and description.",
  sortOrder: 1,
  required: false,
  inputType: "CHECKBOX",
};
// Only rendered when sponsored, so "required" applies only then.
const SPONSOR: Var = {
  key: "SPONSOR_NAME",
  label: "Sponsor's name",
  helpText: "e.g. Sri K Anand",
  sortOrder: 2,
  required: true,
};
const TITLE_VARS: Var[] = [DATE, SPONSORED, SPONSOR];
const DESCRIPTION_VARS: Var[] = [
  DATE,
  SPONSORED,
  SPONSOR,
  {
    key: "OCCASION_TYPE",
    label: "Sponsored",
    helpText: "Used only when the occasion below is filled in.",
    sortOrder: 3,
    required: false,
    inputType: "SELECT",
    options: ["on the occasion of", "in loving memory of"],
    defaultValue: "on the occasion of",
  },
  {
    key: "OCCASION_FOR",
    label: "Occasion or person remembered",
    helpText: "Optional. e.g. his daughter's birthday, or Late Smt. Kamala Devi",
    sortOrder: 4,
    required: false,
  },
];

const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

try {
  const orgs = await client.query(`SELECT id FROM "Organization"`);
  if (orgs.rows.length !== 1) throw new Error(`Expected one organisation, found ${orgs.rows.length}.`);
  const orgId: string = orgs.rows[0].id;

  await client.query("BEGIN");
  const title = await client.query(
    `SELECT id FROM "TitleTemplate" WHERE "organizationId" = $1 AND program = 'FFL' LIMIT 1`,
    [orgId],
  );
  const desc = await client.query(
    `SELECT id FROM "DescriptionTemplate" WHERE "organizationId" = $1 AND program = 'FFL' LIMIT 1`,
    [orgId],
  );
  const created = !desc.rowCount;
  const titleId: string = title.rows[0]?.id ?? randomUUID();
  const descId: string = desc.rows[0]?.id ?? randomUUID();

  await client.query(
    `INSERT INTO "TitleTemplate" (id, "organizationId", name, pattern, "maxLength", "isDefault", "isActive", program, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Food for Life Annadan', $3, 100, false, true, 'FFL', now(), now())
     ON CONFLICT (id) DO UPDATE SET pattern = EXCLUDED.pattern, "updatedAt" = now()`,
    [titleId, orgId, TITLE],
  );
  await client.query(
    `INSERT INTO "DescriptionTemplate" (id, "organizationId", name, body, "isDefault", "isActive", program, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Food for Life Annadan', $3, false, true, 'FFL', now(), now())
     ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, "updatedAt" = now()`,
    [descId, orgId, BODY],
  );

  const upsertVar = (column: string, templateId: string, v: Var) =>
    client.query(
      `INSERT INTO "TemplateVariable" (id, "${column}", key, label, "helpText", "inputType", required, "isLocked", options, "defaultValue", "sortOrder", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, now(), now())
       ON CONFLICT ("${column}", key) DO UPDATE SET label = EXCLUDED.label, "helpText" = EXCLUDED."helpText",
         "inputType" = EXCLUDED."inputType", required = EXCLUDED.required, options = EXCLUDED.options,
         "defaultValue" = EXCLUDED."defaultValue", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now()`,
      [
        randomUUID(),
        templateId,
        v.key,
        v.label,
        v.helpText,
        v.inputType ?? "TEXT",
        v.required,
        v.options ? JSON.stringify(v.options) : null,
        v.defaultValue ?? null,
        v.sortOrder,
      ],
    );
  for (const v of TITLE_VARS) await upsertVar("titleTemplateId", titleId, v);
  for (const v of DESCRIPTION_VARS) await upsertVar("descriptionTemplateId", descId, v);

  let moved = 0;
  if (created) {
    // Drafts already marked Food for Life still point at the general templates.
    const r = await client.query(
      `UPDATE "Submission" SET "titleTemplateId" = $1, "descriptionTemplateId" = $2, "descriptionOverride" = NULL, "updatedAt" = now()
       WHERE "organizationId" = $3 AND program = 'FFL' AND status = 'DRAFT'`,
      [titleId, descId, orgId],
    );
    moved = r.rowCount ?? 0;
  }
  await client.query("COMMIT");
  console.log(
    created
      ? `Created Food for Life templates; moved ${moved} existing draft(s) onto them.`
      : "Updated the Food for Life templates.",
  );
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end();
}
