import { chatJSON } from "./llm.mjs";
import { withOutputLanguage } from "./outputLanguage.mjs";

// 第二步大模型 —— 庖丁的核心差异点：对每一步讲透「为什么」。
// 与「整理」解耦：这里可以用更擅长讲原理的模型，也便于日后对单步反复追问。

const DEPTH_HINT = {
  beginner: "面向零基础新手：多打比方、少用术语，术语必须顺带一句大白话解释。",
  balanced: "新手能看懂、进阶有收获：讲清科学原理（如美拉德反应、锁水、乳化）但用通俗语言。",
  advanced: "面向进阶爱好者：可深入食品科学与火候化学，允许使用专业术语。",
};

// 合法的讲解深度（唯一来源，供 CLI / 服务端校验）。
export const DEPTHS = Object.keys(DEPTH_HINT);

const SYSTEM = (depth) => `你是懂食品科学、会教做菜的中餐老师。为输入菜谱的每个步骤生成"为什么"讲解。${DEPTH_HINT[depth] || DEPTH_HINT.balanced}

每步输出 reason、if_not、cue、risk_level、confidence：
- reason 讲原理，if_not 讲做错后果，cue 给可观察判断点。
- reason/if_not/cue 各用一句话，具体到本步骤，避免空泛。
- risk_level 只能是 "low" | "medium" | "high"。
- confidence 只能是 "high" | "medium" | "low"；信息不足时给 "low"，reason 里说明"原视频信息有限，以下为一般性经验"。

只输出 JSON 对象，不要 markdown、不要多余字段：
{"explanations":[{"index":1,"reason":"...","if_not":"...","cue":"...","risk_level":"low","confidence":"high"}]}
index 必须覆盖输入 steps。`;

function compactStep(s) {
  if (!s || typeof s !== "object") {
    return { index: "", title: "", action: String(s || ""), params: {} };
  }
  return {
    index: s.index,
    title: s.title,
    action: s.action,
    params: s.params,
  };
}

export async function explainSteps(llm, recipe, depth, signal) {
  const compact = {
    title: recipe.title,
    steps: (recipe.steps || []).map(compactStep),
  };

  const out = await chatJSON(llm, {
    system: withOutputLanguage(SYSTEM(depth), llm.outputLang),
    user: JSON.stringify(compact),
    temperature: 0.4,
    signal,
  });

  const byIndex = new Map(
    (out.explanations || []).map((e) => [Number(e.index), e]),
  );

  // 把讲解合并回每一步；缺失的给出兜底占位，绝不静默丢步。
  for (const step of recipe.steps) {
    const e = byIndex.get(Number(step.index));
    step.why = e
      ? { reason: e.reason || "", if_not: e.if_not || "", cue: e.cue || "" }
      : { reason: "（本步未生成讲解）", if_not: "", cue: "" };
    step.risk_level = e?.risk_level || "unknown";
    step.confidence = e?.confidence || "low";
  }
  return recipe;
}
