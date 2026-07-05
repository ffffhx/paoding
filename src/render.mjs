// 结构化菜谱 → 人类可读 Markdown。

const CONF_BADGE = { high: "", medium: " ⚠️ 讲解置信度中", low: " ⚠️ 原视频信息有限，以下为推测" };
const RISK_BADGE = { high: "🔴 新手雷区", medium: "🟡 需留意", low: "", unknown: "" };

export function toMarkdown(recipe, source) {
  const L = [];
  L.push(`# ${recipe.title || "未命名菜谱"}`);
  L.push("");
  const bits = [];
  if (recipe.servings) bits.push(`份量：${recipe.servings}`);
  if (recipe.total_time_min) bits.push(`耗时：约 ${recipe.total_time_min} 分钟`);
  if (source) bits.push(`来源：${source}`);
  if (bits.length) L.push(`> ${bits.join(" ｜ ")}`, "");

  L.push("## 食材");
  for (const ing of recipe.ingredients || []) {
    const note = ing.note ? `（${ing.note}）` : "";
    L.push(`- ${ing.name} · ${ing.amount || "视频未明确"}${note}`);
  }
  L.push("");

  L.push("## 步骤");
  for (const s of recipe.steps || []) {
    const risk = RISK_BADGE[s.risk_level] ? `  ${RISK_BADGE[s.risk_level]}` : "";
    L.push(`### 第 ${s.index} 步 · ${s.title || ""}${risk}`);
    L.push(s.action || "");
    const p = s.params || {};
    const params = [
      p.heat && `火候：${p.heat}`,
      p.temp && `油温：${p.temp}`,
      p.time && `时间：${p.time}`,
      p.cue && `到位：${p.cue}`,
    ].filter(Boolean);
    if (params.length) L.push(`\n\`${params.join(" ｜ ")}\``);

    const w = s.why || {};
    if (w.reason || w.if_not || w.cue) {
      L.push(`\n**🤔 为什么这么做${CONF_BADGE[s.confidence] || ""}**`);
      if (w.reason) L.push(`- 原理：${w.reason}`);
      if (w.if_not) L.push(`- 不这么做：${w.if_not}`);
      if (w.cue) L.push(`- 怎么判断到位：${w.cue}`);
    }
    L.push("");
  }

  L.push("---");
  L.push("*由庖丁自动解析生成，讲解仅供参考，请以实际烹饪为准。*");
  return L.join("\n");
}
