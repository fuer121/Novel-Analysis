import { describe, expect, it } from "vitest";

import { admitL2FactsForIndexGroup, type L2AdmissionFact } from "./l2-admission.js";

const fact = (overrides: Partial<L2AdmissionFact>): L2AdmissionFact => ({
  category: "other",
  entity: "测试异兽",
  aliases: [],
  tags: [],
  related_entities: [],
  fact_type: "identity_clue",
  fact: "测试异兽在本章出现",
  evidence: ["测试异兽"],
  importance: 0.5,
  confidence: 0.6,
  scope_eligible: false,
  scope_basis: "",
  transformation_eligible: false,
  scope_fields_complete: true,
  creature_type: "",
  original_form: "",
  qualification_evidence: [],
  subject_key: "",
  identity_basis: "",
  ...overrides,
});

describe("admitL2FactsForIndexGroup", () => {
  it("admits all schema-valid facts for a general index group", () => {
    const input = [fact({ category: "character", entity: "陈平安" })];

    expect(admitL2FactsForIndexGroup(input, { categoryScope: "general" }, [])).toEqual({
      accepted: input,
      candidates: [],
      rejectedCount: 0,
      verifiedSubjects: [],
    });
  });

  it("admits explicit magical scope and normalizes its category and subject", () => {
    const result = admitL2FactsForIndexGroup([fact({
      entity: "白鹿",
      aliases: ["瑞兽"],
      scope_eligible: true,
      scope_basis: "explicit_nonhuman_species",
      subject_key: "white-deer",
    })], { categoryScope: "magical_creature" }, []);

    expect(result.accepted[0]).toMatchObject({
      category: "magical_creature",
      scope_eligible: true,
      scope_basis: "explicit_nonhuman_species",
      identity_basis: "current_chapter",
    });
    expect(result.verifiedSubjects).toEqual([{ subjectKey: "white-deer", displayName: "白鹿", aliases: ["瑞兽"] }]);
  });

  it("admits a known subject but does not treat a candidate-only subject as known", () => {
    const candidate = fact({ entity: "小蛟", subject_key: "little-jiao", tags: ["异兽"] });
    const known = [{ subjectKey: "verified-jiao", displayName: "老蛟", aliases: ["蛟老"] }];
    const result = admitL2FactsForIndexGroup([
      candidate,
      fact({ entity: "蛟老", subject_key: "", fact_type: "event_record" }),
    ], { categoryScope: "magical_creature" }, known);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({
      entity: "蛟老",
      subject_key: "verified-jiao",
      category: "magical_creature",
      scope_basis: "prior_verified_subject",
      identity_basis: "prior_verified_subject",
    });
    expect(result.candidates).toEqual([candidate]);
    expect(result.verifiedSubjects).toEqual([]);
  });

  it("rejects ordinary humans, animals, artifacts, materials and tentative human similes", () => {
    const result = admitL2FactsForIndexGroup([
      fact({ entity: "年轻剑客", category: "character", fact: "年轻剑客在街上行走" }),
      fact({ entity: "来福", tags: ["普通狗"], fact: "来福是一条年老的普通狗", evidence: ["年老的狗"] }),
      fact({ entity: "符箓", category: "item", fact: "符箓自行飞行" }),
      fact({ entity: "祖荫槐叶", fact: "祖荫槐叶在本章出现" }),
      fact({ entity: "青衣少女", scope_eligible: true, scope_basis: "explicit_nonhuman_species", fact: "青衣少女像一头年幼狐魅", evidence: ["像一头年幼狐魅"] }),
    ], { categoryScope: "magical_creature" }, []);

    expect(result).toMatchObject({ accepted: [], candidates: [], rejectedCount: 5, verifiedSubjects: [] });
  });

  it("rejects fabricated artifact transformation eligibility without explicit evidence", () => {
    const result = admitL2FactsForIndexGroup([fact({
      entity: "飞剑",
      category: "magical_creature",
      scope_eligible: true,
      scope_basis: "explicit_transformation",
      transformation_eligible: true,
      fact: "飞剑具有独立灵智和生物化形能力",
      evidence: ["飞剑会飞行并执行命令"],
    })], { categoryScope: "magical_creature" }, []);

    expect(result).toMatchObject({ accepted: [], candidates: [], rejectedCount: 1 });
  });

  it("uses immutable category scope instead of the group key or model category", () => {
    const eligible = fact({ category: "magical_creature", scope_eligible: true, scope_basis: "explicit_nonhuman_species" });
    expect(admitL2FactsForIndexGroup([eligible], { categoryScope: "general" }, []).accepted).toEqual([eligible]);
    expect(admitL2FactsForIndexGroup([fact({ entity: "普通人物" })], { categoryScope: "magical_creature" }, []).accepted).toEqual([]);
  });
});
