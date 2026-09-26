/**
 * Creates the Pitru Paksha title and description templates.
 * Safe to re-run: does nothing if they already exist.
 *
 *   npx tsx scripts/add-pitru-paksha-template.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const TITLE = "Pitru Paksha Day {{DAY_NUMBER}}. Brahman Bhojan Seva. #pitrupaksha #pitruamavasya";

const BODY = `पितृ पक्ष ब्राह्मण भोजन सेवा - {{DATE_HI}}.

आज का पितृपक्ष ब्राह्मण भोजन सेवा {{SPONSOR_NAME}} जी द्वारा अपने {{IN_MEMORY_OF}} की स्मृति में प्रायोजित किया गया है।

आइए, हम सभी उनके लिए प्रार्थना करें कि श्री श्री निताई गौरचन्द्र एवं श्रील प्रभुपाद की कृपा से उन्हें उन्नत भक्तों का संग प्राप्त हो और वे शीघ्रातिशीघ्र अपने परम गंतव्य भगवद्धाम लौटकर भगवान श्रीकृष्ण की शाश्वत सेवा प्राप्त करें। 🙏

हरे कृष्ण हरे कृष्ण, कृष्ण कृष्ण हरे हरे।हरे राम हरे राम, राम राम हरे हरे।

सेवा करने हेतु  - https://iskconpunebcec.com/#/pitru-paksha/IND2445697

सेवा एवं अधिक जानकारी के लिए संपर्क करें: 
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
  // Filled from the date picker, shown as २६/०९/२०२६.
  { key: "DATE_HI", label: "Date", helpText: "Pick the date above.", sortOrder: 1 },
  { key: "SPONSOR_NAME", label: "Sponsor name", helpText: "e.g. कौशिक गुप्ता", sortOrder: 2 },
  {
    key: "IN_MEMORY_OF",
    label: "In memory of",
    helpText: "e.g. पूज्य पिताजी Late. रतन कुमार गुप्ता जी",
    sortOrder: 3,
  },
];

const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

try {
  const orgs = await client.query(`SELECT id, name FROM "Organization"`);
  if (orgs.rows.length !== 1) throw new Error(`Expected one organisation, found ${orgs.rows.length}.`);
  const orgId: string = orgs.rows[0].id;

  const existing = await client.query(
    `SELECT 1 FROM "DescriptionTemplate" WHERE "organizationId" = $1 AND program = 'PITRU_PAKSHA'`,
    [orgId],
  );
  if (existing.rowCount) {
    console.log("Pitru Paksha templates already exist; nothing to do.");
  } else {
    await client.query("BEGIN");
    const titleId = randomUUID();
    const descId = randomUUID();
    await client.query(
      `INSERT INTO "TitleTemplate" (id, "organizationId", name, pattern, "maxLength", "isDefault", "isActive", program, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Pitru Paksha', $3, 100, false, true, 'PITRU_PAKSHA', now(), now())`,
      [titleId, orgId, TITLE],
    );
    await client.query(
      `INSERT INTO "DescriptionTemplate" (id, "organizationId", name, body, "isDefault", "isActive", program, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Pitru Paksha', $3, false, true, 'PITRU_PAKSHA', now(), now())`,
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

    // Drafts already marked Pitru Paksha still point at the general templates.
    const moved = await client.query(
      `UPDATE "Submission" SET "titleTemplateId" = $1, "descriptionTemplateId" = $2, "updatedAt" = now()
       WHERE "organizationId" = $3 AND program = 'PITRU_PAKSHA' AND status = 'DRAFT'`,
      [titleId, descId, orgId],
    );
    await client.query("COMMIT");
    console.log(`Created Pitru Paksha templates; moved ${moved.rowCount} existing draft(s) onto them.`);
  }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end();
}
