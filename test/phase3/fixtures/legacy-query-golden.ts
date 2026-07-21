export const QUERY_GOLDEN = [
  { name: "single target alias", question: "陈平安/平安后来的飞剑变化", kind: "single-target", mustUse: ["chen-later"] },
  { name: "collection", question: "各境界最强的人分别是谁", kind: "collection", mustCoverWindows: [1, 2, 3] },
  { name: "broad collection", question: "有哪些重要法宝", kind: "collection", forbiddenTarget: "重要法宝" },
  { name: "late chapter", question: "陈平安最后获得了什么", kind: "single-target", mustUse: ["late-fact"] },
] as const;
