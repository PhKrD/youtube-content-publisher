/**
 * Creates the English Pitru Paksha templates (a starting draft; edit the
 * wording in Settings -> Templates) and labels the existing ones as Hindi.
 * Safe to re-run.
 *
 *   npx tsx scripts/add-pitru-paksha-english.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const TITLE = "Pitru Paksha Day {{DAY_NUMBER}}. Brahman Bhojan Seva. #pitrupaksha #pitruamavasya";

const BODY = `Pitru Paksha Brahman Bhojan Seva - {{DATE}}.

Today's Pitru Paksha Brahman Bhojan Seva has been sponsored by {{SPONSOR_NAME}} in loving memory of {{IN_MEMORY_OF}}.

Let us all pray that, by the mercy of Sri Sri Nitai Gaurachandra and Srila Prabhupada, they receive the association of advanced devotees and very soon return to their ultimate destination, the abode of the Lord, to engage in the eternal service of Lord Sri Krishna. 🙏

Hare Krishna Hare Krishna, Krishna Krishna Hare Hare. Hare Rama Hare Rama, Rama Rama Hare Hare.

To offer this seva - https://iskconpunebcec.com/#/pitru-paksha/IND2445697

For seva and more information, contact:
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

type Var = { key: string; label: string; helpText: string; sortOrder: number };

const DAY: Var = { key: "DAY_NUMBER", label: "Day number", helpText: "e.g. 01, 02, 03", sortOrder: 0 };
const DESCRIPTION_VARS: Var[] = [
  DAY,
  // Filled from the date picker, shown as 26 September 2026.
  { key: "DATE", label: "Date", helpText: "Pick the date above.", sortOrder: 1 },
  { key: "SPONSOR_NAME", label: "Sponsor name", helpText: "e.g. Kaushik Gupta", sortOrder: 2 },
  {
    key: "IN_MEMORY_OF",
    label: "In memory of",
    helpText: "e.g. his respected father, Late Shri Ratan Kumar Gupta",
    sortOrder: 3,
  },
];

const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

try {
  const orgs = await client.query(`SELECT id FROM "Organization"`);
  if (orgs.rows.length !== 1) throw new Error(`Expected one organisation, found ${orgs.rows.length}.`);
  const orgId: string = orgs.rows[0].id;

  await client.query("BEGIN");
  for (const table of ["TitleTemplate", "DescriptionTemplate"]) {
    await client.query(
      `UPDATE "${table}" SET name = 'Pitru Paksha (Hindi)', language = 'HI', "updatedAt" = now()
       WHERE "organizationId" = $1 AND program = 'PITRU_PAKSHA' AND name = 'Pitru Paksha'`,
      [orgId],
    );
  }

  const existing = await client.query(
    `SELECT 1 FROM "DescriptionTemplate" WHERE "organizationId" = $1 AND program = 'PITRU_PAKSHA' AND language = 'EN'`,
    [orgId],
  );
  if (existing.rowCount) {
    console.log("English Pitru Paksha templates already exist; nothing to create.");
  } else {
    const titleId = randomUUID();
    const descId = randomUUID();
    await client.query(
      `INSERT INTO "TitleTemplate" (id, "organizationId", name, pattern, "maxLength", "isDefault", "isActive", program, language, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Pitru Paksha (English)', $3, 100, false, true, 'PITRU_PAKSHA', 'EN', now(), now())`,
      [titleId, orgId, TITLE],
    );
    await client.query(
      `INSERT INTO "DescriptionTemplate" (id, "organizationId", name, body, "isDefault", "isActive", program, language, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Pitru Paksha (English)', $3, false, true, 'PITRU_PAKSHA', 'EN', now(), now())`,
      [descId, orgId, BODY],
    );
    const insertVar = (column: string, templateId: string, v: Var) =>
      client.query(
        `INSERT INTO "TemplateVariable" (id, "${column}", key, label, "helpText", "inputType", required, "isLocked", "sortOrder", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'TEXT', true, false, $6, now(), now())`,
        [randomUUID(), templateId, v.key, v.label, v.helpText, v.sortOrder],
      );
    await insertVar("titleTemplateId", titleId, DAY);
    for (const v of DESCRIPTION_VARS) await insertVar("descriptionTemplateId", descId, v);
    console.log("Created English Pitru Paksha templates.");
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end();
}
