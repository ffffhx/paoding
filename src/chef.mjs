import { chatJSON } from "./llm.mjs";
import { applyIngredientFixes } from "./ingredientFix.mjs";
import { withOutputLanguage } from "./outputLanguage.mjs";

// 第一步大模型：把口播/简介整理成结构化菜谱。只做「结构化」，不做「讲原理」。
const SYSTEM = `你是一名专业中餐厨师兼菜谱编辑。用户会给你一段做菜视频的【语音转写】和【视频简介】。
请把它整理成结构化菜谱 JSON。要求：

1. 只依据给定材料，不要凭空编造。转写里没提到的用量/参数，如实留空或写"视频未明确"，绝不臆造具体数字。
2. 步骤要拆细、可执行，保留关键参数：火候、油温、时间、以及"怎么算到位"的状态判断（如"煎至两面金黄""炒出糖色"）。
3. 食材尽量填 qty（数字）与 unit（单位）：能换算成数字就填，如 500克→qty 500/unit 克、三勺→qty 3/unit 勺、两瓣→qty 2/unit 瓣；"适量/少许/视频未明确"这类填 qty null、unit 空。amount 始终保留人类可读原文。
4. 口播里的生活化定量描述是最重要的用量信息，必须原样保留进 amount：拇指长、小拇指粗、指甲盖大（视频若说明是哪个手指要保留）、一元硬币大小、鸡蛋大小、乒乓球大小、巴掌大 等。例：转写说「姜切拇指长一段」→ amount 写 拇指长一段，不得简化成 一段。
5. 食材只给了 一片/一段/一块/一把 这类模糊量、且转写里没有大小参照时：amount 保留原文，并在 note 里给一个常识参考大小，须以「参考：」开头并标注推测性质（例：姜一片 → note: 参考：约硬币大、2毫米厚（常识推测））。转写里已有大小参照时绝不覆盖。
6. steps 里的到位判断/操作描述同样保留身体参照描述，不得抽象化。
7. 【语音转写】来自语音识别，含同音/近音错别字，尤其是香料和食材名。整理时必须按烹饪常识纠正为正确写法（例：白纸→白芷、肉豆扣/肉豆寇→肉豆蔻、草扣→草蔻、山奈→山柰）。纠正过的食材在 note 里标注：转写作「原词」，已按烹饪常识纠正。拿不准是不是错别字时保留原词，不要乱改。
8. 若转写行首带 [分:秒] 时间标记，请为每一步额外输出 "source_time": [起始秒, 结束秒]（整数秒，该步操作在原视频中对应的时间范围）。source_time 必须直接取自转写中真实出现的时间标记，绝不能超过最后一个时间标记的秒数、绝不能凭步骤先后自行外推。转写没有时间标记时不要输出 source_time。
9. 工具/器具清单：
   - 甜品/烘焙类（蛋糕、饼干、慕斯、塔派、面包、裱花、巧克力、糖艺等，由菜品和步骤判断）必须完整列出关键工具：打发器/打蛋器、裱花袋和裱花嘴、抹刀/刮刀、模具（如视频提到尺寸要写明）、油纸、厨房秤、温度计、烤箱等。
   - 每个工具都必须说明 purpose；有替代品时 substitute 写替代方案，substitute_note 写代价/注意点；没有替代品时 substitute 必须为 null，substitute_note 必须写清楚为什么不能替代。
   - 非甜品只列非常规厨具（如蒸锅、砂锅、烤箱、温度计），家家都有的锅碗瓢盆不要列。
   - 视频画面/口播出现过的工具照实提取；没出现但该工艺必需的按常识推断并把 inferred 标 true；拿不准宁可不列。
10. 用简体中文。面向中式家常菜，也能处理甜品/烘焙菜谱。
11. 若用户内容中包含【画面配方卡 / 配料表（高优先级）】或【画面配方卡】，这些来自视频画面中的配方卡/配料表，用量比口播记忆更可靠。与口播冲突时优先采用画面配方卡的用量，并在对应食材 note 里注明「出处：画面配方卡」。
12. 饮品/酱料/卤水/高汤类视频常见「先批量制备基底，再按杯/按份组装」。识别到这种结构时：
   - 给每个食材和步骤额外标 "phase": "batch" 或 "serving"；批量制备基底为 batch，按杯/按份组装为 serving。
   - 输出 batch_info，包含 yield（批量基底产量描述）、makes_servings（能推算时填数字）、makes_note（如「按每杯250毫升推算（推算）」）、serving_desc（单份组装说明）。
   - 能从数量推算份数时（如 1000ml÷每杯250ml≈4杯）写进 makes_servings，并在 makes_note 标注「推算」。
   - 识别不出明确批量/单份结构时不要硬拆，不输出 phase 和 batch_info。
13. 严格输出如下 JSON（不要多余字段、不要注释、不要 markdown）：

{
  "title": "菜名",
  "servings": "份量，如 2人份；未知写 null",
  "total_time_min": 数字或 null,
  "difficulty": "easy | medium | hard（据步骤和技巧难度判断）",
  "cuisine": "菜系，如 川菜/家常菜/粤菜；未知写 家常菜",
  "tags": ["3~5个标签，如 荤菜/快手/下饭/炖菜/宴客"],
  "batch_info": { "yield": "批量基底产量，如 一壶茶汤（约1300毫升）", "makes_servings": 数字或 null, "makes_note": "份数推算说明，若推算必须写明（推算）", "serving_desc": "单份组装说明，如 以下为单杯用量" },
  "ingredients": [ { "name": "食材名", "amount": "原文用量文本，如 500克/三勺/适量；未明确写 视频未明确", "qty": 数字或 null, "unit": "单位如 克/勺/个/毫升/瓣；无则空字符串", "note": "可选备注或空字符串", "phase": "batch | serving，可选" } ],
  "tools": [
    {
      "name": "工具名，如 电动打蛋器",
      "purpose": "干什么用，如 打发蛋白到硬性发泡",
      "essential": true,
      "substitute": "替代方案字符串；无替代时为 null",
      "substitute_note": "有替代时写代价/注意点；无替代时写为什么替不了",
      "inferred": false
    }
  ],
  "steps": [
    {
      "index": 1,
      "title": "该步小标题",
      "action": "具体操作描述",
      "params": { "heat": "火候或空", "temp": "油温或空", "time": "时间或空", "cue": "到位的判断标准或空" },
      "source_time": [起始秒, 结束秒],
      "phase": "batch | serving，可选"
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

export function normalizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const cleanText = (v, max = 240) => {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map((x) => cleanText(x, max)).filter(Boolean).join("、").slice(0, max);
    if (isObj(v)) return cleanText(v.text ?? v.name ?? v.description ?? v["@value"] ?? v.value, max);
    return String(v)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  };
  const asBool = (v) => v === true || v === 1 || ["true", "1"].includes(String(v).trim().toLowerCase());
  return tools.filter(isObj).map((tool) => {
    const name = cleanText(tool.name, 80);
    if (!name) return null;
    const substitute = cleanText(tool.substitute);
    return {
      name,
      purpose: cleanText(tool.purpose),
      essential: asBool(tool.essential),
      substitute: substitute || null,
      substitute_note: cleanText(tool.substitute_note),
      inferred: asBool(tool.inferred),
    };
  }).filter(Boolean);
}

const VALID_PHASES = new Set(["batch", "serving"]);

function cleanText(v, max = 240) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => cleanText(x, max)).filter(Boolean).join("、").slice(0, max);
  if (v && typeof v === "object") return cleanText(v.text ?? v.name ?? v.description ?? v.value, max);
  return String(v)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeBatchInfo(info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  const makes = Number(info.makes_servings);
  const out = {
    yield: cleanText(info.yield, 160),
    makes_servings: Number.isFinite(makes) && makes > 0 ? Math.round(makes * 10) / 10 : null,
    makes_note: cleanText(info.makes_note, 200),
    serving_desc: cleanText(info.serving_desc, 160),
  };
  return Object.values(out).some((v) => v != null && v !== "") ? out : null;
}

export function normalizeRecipePhases(recipe) {
  if (!recipe || typeof recipe !== "object") return recipe;
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : [];
  const steps = Array.isArray(recipe.steps) ? recipe.steps.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : [];
  const targets = [...ingredients, ...steps];
  let sawPhase = false;
  const phases = new Set();

  for (const item of targets) {
    if (!Object.prototype.hasOwnProperty.call(item, "phase")) continue;
    const phase = String(item.phase || "").trim();
    if (VALID_PHASES.has(phase)) {
      item.phase = phase;
      sawPhase = true;
      phases.add(phase);
    } else {
      delete item.phase;
      sawPhase = true;
    }
  }

  const complete = sawPhase
    && targets.length > 0
    && targets.every((item) => VALID_PHASES.has(item.phase))
    && phases.has("batch")
    && phases.has("serving");

  if (!complete) {
    for (const item of targets) delete item.phase;
    delete recipe.batch_info;
    return recipe;
  }

  const batchInfo = normalizeBatchInfo(recipe.batch_info);
  if (batchInfo) recipe.batch_info = batchInfo;
  else delete recipe.batch_info;
  return recipe;
}

export function extractRecipeCardTranscript(transcript) {
  const lines = String(transcript || "").split(/\r?\n/);
  const out = [];
  let collecting = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("【画面配方卡】")) {
      collecting = true;
      out.push(line);
      continue;
    }
    if (!collecting) continue;
    if (/^【[^】]+】/.test(trimmed) && !trimmed.includes("【画面配方卡】")) {
      collecting = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function structureRecipe(llm, { transcript, meta, signal }) {
  const cardTranscript = extractRecipeCardTranscript(transcript);
  const cardBlock = cardTranscript ? `【画面配方卡 / 配料表（高优先级）】
以下来自视频画面中的配方卡/配料表，用量以它为准（比口播记忆更可靠），与口播冲突时优先采用，并在对应食材 note 里注明「出处：画面配方卡」。
${cardTranscript}

` : "";
  const user = `【视频标题】${meta.title || "（无）"}
【视频简介】${(meta.description || "（无）").slice(0, 2000)}

${cardBlock}【语音转写】
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
  applyIngredientFixes(recipe);
  recipe.tools = normalizeTools(recipe.tools);
  normalizeRecipePhases(recipe);
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
