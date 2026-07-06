import { chatJSON } from "./llm.mjs";

// 第二步大模型 —— 庖丁的核心差异点：对每一步讲透「为什么」。
// 与「整理」解耦：这里可以用更擅长讲原理的模型，也便于日后对单步反复追问。

const DEPTH_HINT = {
  beginner: "面向零基础新手：多打比方、少用术语，术语必须顺带一句大白话解释。",
  balanced: "新手能看懂、进阶有收获：讲清科学原理（如美拉德反应、锁水、乳化）但用通俗语言。",
  advanced: "面向进阶爱好者：可深入食品科学与火候化学，允许使用专业术语。",
};

// 合法的讲解深度（唯一来源，供 CLI / 服务端校验）。
export const DEPTHS = Object.keys(DEPTH_HINT);

const SYSTEM = (depth) => `你是一位既懂食品科学、又会教做菜的中餐老师。
用户会给你一份已经结构化的菜谱（含分步骤）。请为【每一步】生成"为什么"讲解。${DEPTH_HINT[depth] || DEPTH_HINT.balanced}

对每一步给出：
- reason：为什么要这么做（背后的原理）。
- if_not：如果不这么做 / 做错了会怎样（具体后果，如粘锅、发腥、变老、不入味）。
- cue：怎么判断这一步到位了（可操作的观察点）。
- risk_level："low" | "medium" | "high"，表示这步对新手来说翻车的风险。
- confidence："high" | "medium" | "low"。如果原步骤信息太少、你的讲解主要靠通用烹饪常识推测而非该菜谱本身，就给 "low"。

铁律：宁可诚实说"这步原视频信息有限，以下为一般性经验"，也不要编造具体的温度/时间/独家原理。confidence 为 low 时，reason 里要点明这是推测。

严格输出 JSON（不要 markdown、不要多余字段）：
{ "explanations": [ { "index": 1, "reason": "...", "if_not": "...", "cue": "...", "risk_level": "low", "confidence": "high" } ] }
每个 index 必须与输入步骤一一对应。`;

export async function explainSteps(llm, recipe, depth, signal) {
  const compact = {
    title: recipe.title,
    steps: recipe.steps.map((s) => ({
      index: s.index,
      title: s.title,
      action: s.action,
      params: s.params,
    })),
  };

  const out = await chatJSON(llm, {
    system: SYSTEM(depth),
    user: `菜谱：\n${JSON.stringify(compact, null, 2)}`,
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
