import { db } from "../src/lib/db";

async function addPitruPakshaTemplates() {
  const org = await db.organization.findFirst();
  if (!org) {
    console.error("No organization found");
    process.exit(1);
  }

  console.log(`Creating Pitru Paksha templates for organization: ${org.name}`);

  // Create title template
  const titleTemplate = await db.titleTemplate.create({
    data: {
      organizationId: org.id,
      name: "Pitru Paksha",
      pattern: "Pitru Paksha Day {{DAY_NUMBER}}. Brahman Bhojan Seva",
      maxLength: 100,
      isDefault: false,
      isActive: true,
      program: "PITRU_PAKSHA",
    },
  });

  // Create title template variable
  await db.templateVariable.create({
    data: {
      titleTemplateId: titleTemplate.id,
      key: "DAY_NUMBER",
      label: "Day number",
      helpText: "e.g., Day 01, Day 02",
      inputType: "TEXT",
      required: true,
      isLocked: false,
      defaultValue: "01",
      sortOrder: 0,
    },
  });

  // Create description template
  const descriptionTemplate = await db.descriptionTemplate.create({
    data: {
      organizationId: org.id,
      name: "Pitru Paksha",
      body: `Pitru Paksha Day {{DAY_NUMBER}}. Brahman Bhojan Seva.  [#pitrupaksha](https://www.youtube.com/hashtag/pitrupaksha/shorts)[#pitruamavasya](https://www.youtube.com/hashtag/pitruamavasya/shorts)

पितृ पक्ष ब्राह्मण भोजन सेवा - {{DATE}}.

आज का पितृपक्ष ब्राह्मण भोजन सेवा {{SPONSOR_NAME}} जी द्वारा अपने {{RELATION_NAME}} {{RELATION_DETAILS}} की स्मृति में प्रायोजित किया गया है।

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
His Divine Grace Srila Prabhupada is the founder acharya of ISKCON. On 17th September 1965, A.C. Bhaktivedanta Swami Srila Prabhupada entered the port of the New York City. His visit aimed to introduce a very old religion, which originated in India.`,
      isDefault: false,
      isActive: true,
      program: "PITRU_PAKSHA",
    },
  });

  // Create description template variables
  const variables = [
    {
      key: "DAY_NUMBER",
      label: "Day number",
      helpText: "e.g., Day 01, Day 02",
      inputType: "TEXT" as const,
      required: true,
      isLocked: false,
      defaultValue: "01",
      sortOrder: 0,
    },
    {
      key: "DATE",
      label: "Date",
      helpText: "e.g., २६/०९/२०२६",
      inputType: "TEXT" as const,
      required: true,
      isLocked: false,
      defaultValue: "",
      sortOrder: 1,
    },
    {
      key: "SPONSOR_NAME",
      label: "Sponsor name",
      helpText: "e.g., कौशिक गुप्ता",
      inputType: "TEXT" as const,
      required: true,
      isLocked: false,
      defaultValue: "",
      sortOrder: 2,
    },
    {
      key: "RELATION_NAME",
      label: "Relation",
      helpText: "e.g., पूज्य पिताजी, पूज्य माताजी",
      inputType: "TEXT" as const,
      required: true,
      isLocked: false,
      defaultValue: "पूज्य पिताजी",
      sortOrder: 3,
    },
    {
      key: "RELATION_DETAILS",
      label: "Relation details",
      helpText: "e.g., Late. रतन कुमार गुप्ता जी",
      inputType: "TEXT" as const,
      required: true,
      isLocked: false,
      defaultValue: "",
      sortOrder: 4,
    },
  ];

  for (const v of variables) {
    await db.templateVariable.create({
      data: {
        descriptionTemplateId: descriptionTemplate.id,
        ...v,
      },
    });
  }

  console.log("✓ Pitru Paksha templates created successfully");
  console.log(`  Title template ID: ${titleTemplate.id}`);
  console.log(`  Description template ID: ${descriptionTemplate.id}`);
}

addPitruPakshaTemplates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
