export const legacyChapterImportRaw = {
  chapters: [
    { chapter_index: 1, title: "第一章", content: "正文一" },
    { sortid: 2, chapter_title: "第二章", text: "正文二" },
  ],
};

export const chapterImportOutput = {
  chapters: [
    { book_id: "", chapter_index: 1, chapter_title: "第一章", content: "正文一", fetch_status: "ok" },
    { book_id: "", chapter_index: 2, chapter_title: "第二章", content: "正文二", fetch_status: "ok" },
  ],
};

export const legacyL1IndexRaw = {
  route_schema_version: "l1-route-v1",
  route_entities: [
    { name: "陈平安", type: "character", aliases: ["平安"], role: "主角", note: "核心主体" },
  ],
  route_keywords: ["陈平安", "飞剑"],
  signals: [
    { category: "item", strength: 0.9, entities: ["飞剑"], keywords: ["飞剑"], reason: "高价值物件" },
  ],
  category_scores: { item: 0.9 },
};

export const l1IndexOutput = legacyL1IndexRaw;

export const legacyL2IndexRaw = {
  chapter_index: 221,
  chapter_title: "剑仙来此",
  facts: [
    {
      category: "item",
      entity: "初一",
      aliases: ["本命飞剑"],
      tags: ["飞剑"],
      related_entities: ["陈平安"],
      fact_type: "origin",
      fact: "初一是陈平安本命飞剑之一。",
      evidence: ["本命飞剑"],
      importance: 0.8,
      confidence: 0.9,
    },
  ],
};

export const l2IndexOutput = {
  chapter_index: 221,
  chapter_title: "剑仙来此",
  facts: [
    {
      ...legacyL2IndexRaw.facts[0],
      scope_eligible: false,
      scope_basis: "",
      transformation_eligible: false,
      scope_fields_complete: false,
      creature_type: "",
      original_form: "",
      qualification_evidence: [],
      subject_key: "",
      identity_basis: "",
    },
  ],
};

export const legacyEnvelopeCases = <T>(output: T): unknown[] => [
  JSON.stringify(output),
  output,
  { result: JSON.stringify(output) },
  { text: JSON.stringify(output) },
  { output },
  { data: output },
];

export const legacyFactCategories = [
  "character",
  "relationship",
  "cultivation",
  "force",
  "item",
  "magical_creature",
  "location",
  "event",
  "foreshadowing",
  "other",
] as const;

export const emptyOutputs = {
  "chapter-import": { chapters: [] },
  "l1-index": {
    route_schema_version: "l1-route-v1",
    route_entities: [],
    route_keywords: [],
    signals: [],
    category_scores: {},
  },
  "l2-index": { chapter_index: 221, chapter_title: "剑仙来此", facts: [] },
} as const;
