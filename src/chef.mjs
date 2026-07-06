import { chatJSON } from "./llm.mjs";
import { withOutputLanguage } from "./outputLanguage.mjs";

// 第一步大模型：把口播/简介整理成结构化菜谱。只做「结构化」，不做「讲原理」。
const SYSTEM = `你是一名专业中餐厨师兼菜谱编辑。用户会给你一段做菜视频的【语音转写】和【视频简介】。
请把它整理成结构化菜谱 JSON。要求：

1. 只依据给定材料，不要凭空编造。转写里没提到的用量/参数，如实留空或写"视频未明确"，绝不臆造具体数字。
2. 步骤要拆细、可执行，保留关键参数：火候、油温、时间、以及"怎么算到位"的状态判断（如"煎至两面金黄""炒出糖色"）。
3. 食材尽量填 qty（数字）与 unit（单位）：能换算成数字就填，如 500克→qty 500/unit 克、三勺→qty 3/unit 勺、两瓣→qty 2/unit 瓣；"适量/少许/视频未明确"这类填 qty null、unit 空。amount 始终保留人类可读原文。
4. 若转写行首带 [分:秒] 时间标记，请为每一步额外输出 "source_time": [起始秒, 结束秒]（整数秒，该步操作在原视频中对应的时间范围）。source_time 必须直接取自转写中真实出现的时间标记，绝不能超过最后一个时间标记的秒数、绝不能凭步骤先后自行外推。转写没有时间标记时不要输出 source_time。
5. 用简体中文。面向中式家常菜。
6. 严格输出如下 JSON（不要多余字段、不要注释、不要 markdown）：

{
  "title": "菜名",
  "servings": "份量，如 2人份；未知写 null",
  "total_time_min": 数字或 null,
  "difficulty": "easy | medium | hard（据步骤和技巧难度判断）",
  "cuisine": "菜系，如 川菜/家常菜/粤菜；未知写 家常菜",
  "tags": ["3~5个标签，如 荤菜/快手/下饭/炖菜/宴客"],
  "ingredients": [ { "name": "食材名", "amount": "原文用量文本，如 500克/三勺/适量；未明确写 视频未明确", "qty": 数字或 null, "unit": "单位如 克/勺/个/毫升/瓣；无则空字符串", "note": "可选备注或空字符串" } ],
  "steps": [
    {
      "index": 1,
      "title": "该步小标题",
      "action": "具体操作描述",
      "params": { "heat": "火候或空", "temp": "油温或空", "time": "时间或空", "cue": "到位的判断标准或空" },
      "source_time": [起始秒, 结束秒]
    }
  ]
}`;

// 用转写的真实最大时间戳硬校验各步的 source_time：模型偶尔会凭步骤先后外推出超过片长的时间，
// 全部越界的步骤直接去掉时间（宁可无图也不配片尾的错误帧），部分越界的截断到最大时间。
export function clampStepTimes(steps, maxEndSec) {
  if (!Number.isFinite(maxEndSec) || maxEndSec <= 0) return;
  for (const s of steps || []) {
    if (!Array.isArray(s.source_time)) continue;
    if (s.source_time[0] >= maxEndSec) delete s.source_time;
    else s.source_time[1] = Math.min(s.source_time[1], Math.ceil(maxEndSec));
  }
}

// 规整 LLM 输出的 source_time：必须是 [起, 止] 两个非负数且起<止，否则返回 null。
export function normalizeSourceTime(st) {
  if (!Array.isArray(st) || st.length !== 2) return null;
  let [a, b] = st.map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  if (a > b) [a, b] = [b, a];
  if (b - a < 0.5) b = a + 2; // 模型偶尔给出零长度区间，兜成 2 秒窗口
  return [Math.round(a), Math.round(b)];
}

export async function structureRecipe(llm, { transcript, meta, signal }) {
  const user = `【视频标题】${meta.title || "（无）"}
【视频简介】${(meta.description || "（无）").slice(0, 2000)}

【语音转写】
${transcript}`;

  const recipe = await chatJSON(llm, { system: withOutputLanguage(SYSTEM, llm.outputLang), user, temperature: 0.2, signal });

  // 防御式规整：小模型常吐出脏结构（步骤里混字符串等），只保留对象、绝不让下游崩。
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  recipe.steps = (Array.isArray(recipe.steps) ? recipe.steps : []).filter(isObj);
  recipe.steps.forEach((s, i) => {
    s.index = Number.isFinite(s.index) ? s.index : i + 1;
    if (!isObj(s.params)) s.params = {};
    const st = normalizeSourceTime(s.source_time);
    if (st) s.source_time = st;
    else delete s.source_time;
  });
  recipe.ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter(isObj);
  if (!Array.isArray(recipe.tags)) recipe.tags = [];
  if (!recipe.difficulty) recipe.difficulty = "medium";
  if (!recipe.cuisine) recipe.cuisine = "家常菜";

  if (recipe.steps.length === 0) {
    throw new Error(
      "模型未能产出有效步骤（常见于模型过小）。建议换用更强的模型，如 `ollama pull qwen2.5:14b`。",
    );
  }
  return recipe;
}
