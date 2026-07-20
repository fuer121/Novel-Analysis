import type { L2IndexOutput } from "@novel-analysis/contracts";

export type L2AdmissionFact = L2IndexOutput["facts"][number];
export type L2AdmissionSubject = { subjectKey: string; displayName: string; aliases: string[] };

const SCOPE_BASES = new Set([
  "explicit_nonhuman_species",
  "explicit_sentience",
  "explicit_transformation",
  "explicit_supernatural_origin",
  "explicit_undead_origin",
  "explicit_fortune_manifestation",
  "explicit_plant_spirit",
]);

const text = (fact: L2AdmissionFact): string => [fact.entity, ...fact.aliases, ...fact.tags, fact.fact, ...fact.evidence].join(" ").toLowerCase();

function isArtifact(fact: L2AdmissionFact): boolean {
  return /飞剑|剑胚|剑灵|老剑条|锈剑条|铁剑|长剑|养剑葫|法宝|兵器|符箓|符纸|傀儡|神像|荷叶伞|压衣刀|斩龙台|符纸甲士|开山傀儡|卸岭甲士/.test(text(fact));
}

function isNonCreatureObject(fact: L2AdmissionFact): boolean {
  return /茶壶|茶杯|槐叶|叶片|牌坊|石头|石块|矿石|胆石|材料|木料|树枝|树叶/.test(text(fact));
}

function isOrdinaryHuman(fact: L2AdmissionFact): boolean {
  return /普通人物|普通人|人物|修士|道人|剑客|铁匠|妇人|女子|少年|少女|老人|男子|男人|年轻人/.test(text(fact))
    || /^(年轻|高大|白衣|红衣|长春宫|帷帽少女|年轻剑客|道人|修士|老人|妇人|女子|少年|少女|男子|男人)/.test(fact.entity.trim());
}

function isOrdinaryAnimal(fact: L2AdmissionFact): boolean {
  const value = text(fact);
  return /普通动物|普通狗|家犬|老狗|家养狗/.test(value) && !/异兽|妖|灵兽|神兽|灵智|化形|神通|修为|异常血脉|超自然/.test(value);
}

function isTentativeHumanSimile(fact: L2AdmissionFact): boolean {
  const value = [fact.fact, ...fact.evidence].join(" ");
  return /^(青衣|白衣|红衣|黑衣|高大|年轻)?(少女|女子|少年|男子|老人|妇人|男人|女人)/.test(fact.entity.trim())
    && /像|仿佛|如同|好似/.test(value)
    && !/明确[^。；，,]{0,12}本体|真身|原文[^。；，,]{0,12}是|化形|幻化|变作/.test(value);
}

function hasTransformationEvidence(fact: L2AdmissionFact): boolean {
  return /化为人形|幻化为人形|化作人形|变作人形|化为动物|化作动物|变作动物|以[^，。；,.;]{1,12}(人形|动物形态)出现|现出人形/.test([fact.fact, ...fact.evidence].join(" "));
}

function explicitlyEligible(fact: L2AdmissionFact): boolean {
  if (isTentativeHumanSimile(fact)) return false;
  if (isArtifact(fact) && (fact.scope_basis !== "explicit_transformation" || !fact.transformation_eligible || !hasTransformationEvidence(fact))) return false;
  return fact.scope_eligible && SCOPE_BASES.has(fact.scope_basis)
    && (fact.scope_basis !== "explicit_transformation" || fact.transformation_eligible);
}

function matchingKnown(fact: L2AdmissionFact, subjects: readonly L2AdmissionSubject[]): L2AdmissionSubject | undefined {
  const values = [fact.entity, ...fact.aliases].map((value) => value.trim()).filter(Boolean);
  return subjects.find((subject) => values.some((value) => [subject.displayName, subject.subjectKey, ...subject.aliases]
    .some((name) => value === name || value.includes(name) || name.includes(value))));
}

function hardExcluded(fact: L2AdmissionFact): boolean {
  return isArtifact(fact) || isNonCreatureObject(fact) || isOrdinaryHuman(fact) || isOrdinaryAnimal(fact) || isTentativeHumanSimile(fact);
}

function candidateEligible(fact: L2AdmissionFact): boolean {
  if (hardExcluded(fact)) return false;
  if (fact.fact_type === "identity_clue") return true;
  return /异兽|妖|精|鬼|灵|化形|人形|灵智|通灵|大妖|水神|山神|鬼魅|阴物|祥瑞|神兽|树妖|狐妖|蛇精/.test(text(fact));
}

export function admitL2FactsForIndexGroup(
  facts: readonly L2AdmissionFact[],
  indexGroup: { categoryScope: "general" | "magical_creature" },
  knownSubjects: readonly L2AdmissionSubject[],
): { accepted: L2AdmissionFact[]; candidates: L2AdmissionFact[]; rejectedCount: number; verifiedSubjects: L2AdmissionSubject[] } {
  if (indexGroup.categoryScope !== "magical_creature") {
    return { accepted: [...facts], candidates: [], rejectedCount: 0, verifiedSubjects: [] };
  }

  const accepted: L2AdmissionFact[] = [];
  const candidates: L2AdmissionFact[] = [];
  const verifiedSubjects: L2AdmissionSubject[] = [];
  for (const fact of facts) {
    const explicit = explicitlyEligible(fact);
    const known = explicit || hardExcluded(fact) ? undefined : matchingKnown(fact, knownSubjects);
    if (explicit || known) {
      const subjectKey = known?.subjectKey ?? (fact.subject_key.trim() || fact.entity.trim());
      accepted.push({
        ...fact,
        category: "magical_creature",
        subject_key: subjectKey,
        scope_eligible: true,
        scope_basis: explicit ? fact.scope_basis : "prior_verified_subject",
        identity_basis: explicit ? "current_chapter" : "prior_verified_subject",
      });
      if (explicit) verifiedSubjects.push({ subjectKey, displayName: fact.entity.trim(), aliases: fact.aliases });
    } else if (candidateEligible(fact)) {
      candidates.push(fact);
    }
  }
  return { accepted, candidates, rejectedCount: facts.length - accepted.length - candidates.length, verifiedSubjects };
}
