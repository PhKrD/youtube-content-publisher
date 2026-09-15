/**
 * Seeds an organisation with working defaults.
 *
 * The templates here are not filler — they are the product demonstrating
 * itself. A new administrator gets a title pattern and a description skeleton
 * with locked organisational sections already wired up, so the first
 * contributor to sign in can produce a correctly-formatted YouTube description
 * by filling in three fields.
 *
 * Idempotent: safe to run repeatedly. Nothing here contacts Google or
 * publishes anything.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ApprovalMode,
  PrismaClient,
  TemplateInputType,
} from "../src/generated/prisma";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or DIRECT_URL) must be set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_NAME = process.env.SEED_ORG_NAME || "My Organization";
const ORG_SLUG = process.env.SEED_ORG_SLUG || "default";

const DESCRIPTION_BODY = `Hare Krishna!

Welcome to {{PROGRAM_NAME}}.

Today's topic:
{{TOPIC}}

Speaker:
{{SPEAKER_NAME}}

Date:
{{DATE}}

{{MAIN_DESCRIPTION}}

For more information:
{{CONTACT_INFORMATION}}

{{SOCIAL_LINKS}}

{{HASHTAGS}}`;

async function main() {
  console.log(`Seeding organisation "${ORG_NAME}" (${ORG_SLUG})…\n`);

  const org = await db.organization.upsert({
    where: { slug: ORG_SLUG },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      approvalMode: ApprovalMode.APPROVAL_REQUIRED,
      // Off by default, always. An administrator must consciously turn this on
      // after confirming the channel (Sections 9 and 40).
      productionPublishingEnabled: false,
    },
    update: { name: ORG_NAME },
  });
  console.log(`  organisation: ${org.id}`);

  // ---- title template (Section 15) ----
  const title = await db.titleTemplate.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Standard" } },
    create: {
      organizationId: org.id,
      name: "Standard",
      pattern: "{{PROGRAM_NAME}} | {{TOPIC}} | {{SPEAKER_NAME}}",
      maxLength: 100,
      isDefault: true,
      isActive: true,
    },
    update: {},
  });

  const titleVars = [
    { key: "PROGRAM_NAME", label: "Programme", sortOrder: 1, helpText: "e.g. Bhagavad Gita Workshop" },
    { key: "TOPIC", label: "Topic", sortOrder: 2, helpText: "e.g. Who Am I?" },
    { key: "SPEAKER_NAME", label: "Speaker", sortOrder: 3, helpText: "Name of the speaker" },
  ];
  for (const v of titleVars) {
    await db.templateVariable.upsert({
      where: { titleTemplateId_key: { titleTemplateId: title.id, key: v.key } },
      create: {
        titleTemplateId: title.id,
        key: v.key,
        label: v.label,
        helpText: v.helpText,
        inputType: TemplateInputType.TEXT,
        required: true,
        sortOrder: v.sortOrder,
      },
      update: { label: v.label, helpText: v.helpText },
    });
  }
  console.log(`  title template: "${title.pattern}"`);

  // ---- description template (Sections 16 & 17) ----
  const description = await db.descriptionTemplate.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Standard programme" } },
    create: {
      organizationId: org.id,
      name: "Standard programme",
      body: DESCRIPTION_BODY,
      isDefault: true,
      isActive: true,
    },
    update: { body: DESCRIPTION_BODY },
  });

  /**
   * `isLocked: true` is the important part. These values are substituted from
   * the template definition and any value a contributor submits for them is
   * discarded server-side, so official contact details, links and mandatory
   * hashtags cannot be edited or removed by a student.
   */
  const descriptionVars = [
    {
      key: "PROGRAM_NAME",
      label: "Programme",
      inputType: TemplateInputType.TEXT,
      required: true,
      sortOrder: 1,
      helpText: "Also used in the title.",
    },
    {
      key: "TOPIC",
      label: "Topic",
      inputType: TemplateInputType.TEXT,
      required: true,
      sortOrder: 2,
    },
    {
      key: "SPEAKER_NAME",
      label: "Speaker",
      inputType: TemplateInputType.TEXT,
      required: true,
      sortOrder: 3,
    },
    {
      key: "DATE",
      label: "Date of the programme",
      inputType: TemplateInputType.DATE,
      required: true,
      sortOrder: 4,
    },
    {
      key: "MAIN_DESCRIPTION",
      label: "What happened in this session",
      inputType: TemplateInputType.TEXTAREA,
      required: true,
      sortOrder: 5,
      helpText: "A few sentences in your own words. This is the only long piece of writing needed.",
      maxLength: 3000,
    },
    {
      key: "CONTACT_INFORMATION",
      label: "Contact information",
      inputType: TemplateInputType.TEXTAREA,
      required: false,
      sortOrder: 6,
      isLocked: true,
      lockedValue: "Email: info@example.org\nWebsite: https://example.org",
      helpText: "Locked by an administrator.",
    },
    {
      key: "SOCIAL_LINKS",
      label: "Social links",
      inputType: TemplateInputType.TEXTAREA,
      required: false,
      sortOrder: 7,
      isLocked: true,
      lockedValue: "Instagram: https://instagram.com/example\nFacebook: https://facebook.com/example",
      helpText: "Locked by an administrator.",
    },
    {
      key: "HASHTAGS",
      label: "Hashtags",
      inputType: TemplateInputType.TEXT,
      required: false,
      sortOrder: 8,
      isLocked: true,
      lockedValue: "#BhagavadGita #Krishna #Spirituality #Youth",
      helpText: "Locked by an administrator.",
    },
  ];

  for (const v of descriptionVars) {
    await db.templateVariable.upsert({
      where: { descriptionTemplateId_key: { descriptionTemplateId: description.id, key: v.key } },
      create: { descriptionTemplateId: description.id, ...v },
      update: {
        label: v.label,
        inputType: v.inputType,
        required: v.required,
        sortOrder: v.sortOrder,
        helpText: v.helpText,
        isLocked: v.isLocked ?? false,
        lockedValue: v.lockedValue ?? null,
      },
    });
  }
  console.log(`  description template: ${descriptionVars.length} fields (3 locked)`);

  // ---- tag groups (Section 18) ----
  const tagGroups = [
    {
      name: "Organisation (required)",
      tags: ["BhagavadGita", "Krishna", "Spirituality"],
      isMandatory: true,
      sortOrder: 1,
    },
    { name: "Bhagavad Gita", tags: ["Gita", "Vedanta", "Philosophy"], isMandatory: false, sortOrder: 2 },
    { name: "Youth programme", tags: ["Youth", "Students", "Motivation"], isMandatory: false, sortOrder: 3 },
  ];
  for (const g of tagGroups) {
    await db.tagGroup.upsert({
      where: { organizationId_name: { organizationId: org.id, name: g.name } },
      create: { organizationId: org.id, ...g },
      update: { tags: g.tags, isMandatory: g.isMandatory },
    });
  }
  console.log(`  tag groups: ${tagGroups.length} (1 mandatory)`);

  console.log("\nSeed complete.\n");
  console.log("Next steps:");
  console.log("  1. Set BOOTSTRAP_ADMIN_EMAIL in .env to your Google address.");
  console.log("  2. npm run dev, then sign in — you become the administrator.");
  console.log("  3. Open /setup to connect Google and confirm your YouTube channel.\n");
}

main()
  .catch((e) => {
    console.error("\nSeed failed:\n", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
