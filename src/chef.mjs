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
8. 若转写行首带 [分:秒] 时间标记，请为每一步尽量输出 "source_time": [起始秒, 结束秒]（整数秒，该步操作在原视频中对应的时间范围）。每一步都应优先匹配到转写里真实出现的相邻时间标记；确实找不到对应时间标记时才省略，仍缺失也必须如实保留为空。source_time 必须直接取自转写中真实出现的时间标记，绝不能超过最后一个时间标记的秒数，绝不能凭步骤先后自行外推或为了补齐覆盖率伪造。转写没有时间标记时不要输出 source_time。
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

export function sourceTimeCoverage(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const total_steps = list.length;
  const steps_with_source_time = list.filter((s) => Array.isArray(s?.source_time) && s.source_time.length === 2).length;
  return {
    steps_with_source_time,
    total_steps,
    summary: `${steps_with_source_time}/${total_steps} 步有时间戳`,
  };
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

const BAKING_CONTEXT_RE = /甜品|甜点|点心|蛋糕|戚风|海绵蛋糕|慕斯|饼干|曲奇|塔|派|面包|吐司|烘焙|裱花|淡奶油|巧克力|可可|糖霜|糖艺|蛋白霜|玛芬|布丁|泡芙|酥皮|雪媚娘|马卡龙|司康|可颂|蛋挞|芝士蛋糕|提拉米苏|低筋面粉|高筋面粉|吉利丁|糖粉/;
const BAKING_PROCESS_RE = /烤箱|烘烤|发酵|醒发|打发|过筛|裱花|脱模|入模|模具|蛋糕体|翻拌/;
const BAKING_INGREDIENT_RE = /面粉|黄油|奶油|蛋白|蛋黄|白糖|糖粉|可可|酵母|吉利丁|巧克力/;

const BAKING_TOOL_RULES = [
  {
    name: "打蛋器",
    aliases: ["打蛋器", "打发器", "电动打蛋器", "手动打蛋器", "厨师机"],
    pattern: /打发|打蛋|蛋白[^，。；\n]{0,12}发泡|发泡/,
    purpose: "打发蛋白、奶油或蛋液，形成稳定泡沫结构",
    substitute: "手动打蛋器",
    substitute_note: "可行但耗时费力，打发稳定性更差。",
  },
  {
    name: "模具",
    aliases: ["模具", "戚风模", "蛋糕模", "吐司盒", "慕斯圈", "塔模", "纸杯模"],
    pattern: /模具|脱模|入模|倒入[^，。；\n]{0,12}模|蛋糕模|戚风模|吐司盒|慕斯圈|塔模/,
    purpose: "承托面糊并帮助成型",
    substitute: null,
    substitute_note: "烘焙成型和受热高度依赖对应尺寸、材质的模具，普通容器难以稳定替代。",
  },
  {
    name: "筛网",
    aliases: ["筛网", "面粉筛", "粉筛", "细筛"],
    pattern: /过筛|筛入|面粉筛|粉筛/,
    purpose: "筛散粉类，减少结块并让面糊更细腻",
    substitute: "细目滤网",
    substitute_note: "可代替过筛，但效率和均匀度略差。",
  },
  {
    name: "烤箱",
    aliases: ["烤箱"],
    pattern: /烤箱|烘烤|预热[^，。；\n]{0,12}度|上下火/,
    purpose: "提供稳定温度完成烘烤",
    substitute: null,
    substitute_note: "烘烤温度、上下火和空间受热环境难以等价替代。",
  },
  {
    name: "深烤盘",
    aliases: ["深烤盘", "深盘", "水浴盘"],
    pattern: /水浴|水浴法|隔水烤/,
    purpose: "盛热水做水浴，稳定温度并防止表面开裂",
    substitute: "深耐热烤盘",
    substitute_note: "需要足够深度和耐热性，水位不足会削弱水浴效果。",
  },
  {
    name: "裱花袋",
    aliases: ["裱花袋", "裱花嘴", "挤花袋"],
    pattern: /裱花|挤花|挤入[^，。；\n]{0,8}袋/,
    purpose: "挤出奶油、面糊或装饰线条",
    substitute: "保鲜袋剪小口",
    substitute_note: "可临时代替，但线条粗细和稳定性较差。",
  },
  {
    name: "耐热盆",
    aliases: ["耐热盆", "耐热碗", "打蛋盆", "搅拌盆"],
    pattern: /隔水|融化|盆中|蛋白盆|蛋黄盆|打蛋盆|搅拌盆/,
    purpose: "承装并混合材料，或用于隔水加热融化",
    substitute: "耐热碗",
    substitute_note: "容量较小会影响搅拌和隔水受热，必须确认材质耐热。",
  },
  {
    name: "烤架",
    aliases: ["烤架", "晾架", "冷却架"],
    pattern: /倒扣|晾架|冷却架|烤架|放凉/,
    purpose: "烘烤后架空散热，避免底部回潮或塌陷",
    substitute: null,
    substitute_note: "需要架空通风支撑，平放盘中会影响散热和成品形态。",
  },
  {
    name: "刮刀",
    aliases: ["刮刀", "抹刀", "硅胶刮刀"],
    pattern: /翻拌|切拌|刮刀|抹刀/,
    purpose: "翻拌面糊并刮净盆壁，减少消泡",
    substitute: "饭勺或硅胶铲",
    substitute_note: "可临时代替，但边缘贴合度差，容易消泡或混合不均。",
  },
];

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

function recipeText(recipe, { includeSteps = true } = {}) {
  if (!recipe || typeof recipe !== "object") return "";
  const values = [];
  values.push(recipe.title, recipe.cuisine);
  if (Array.isArray(recipe.tags)) values.push(...recipe.tags);
  if (Array.isArray(recipe.ingredients)) {
    for (const ing of recipe.ingredients) values.push(ing?.name, ing?.amount, ing?.note);
  }
  if (includeSteps && Array.isArray(recipe.steps)) {
    for (const step of recipe.steps) values.push(step?.title, step?.action, step?.params);
  }
  return cleanText(values, 8000);
}

function hasBakingContext(recipe) {
  const allText = recipeText(recipe);
  if (BAKING_CONTEXT_RE.test(allText)) return true;
  return BAKING_PROCESS_RE.test(recipeText(recipe, { includeSteps: true })) && BAKING_INGREDIENT_RE.test(allText);
}

function toolExists(tools, rule) {
  const text = cleanText(tools.map((tool) => `${tool.name} ${tool.purpose}`).join(" "), 4000);
  return [rule.name, ...rule.aliases].some((alias) => text.includes(alias));
}

export function inferBakingToolFallback(recipe, tools = recipe?.tools) {
  const normalized = normalizeTools(tools);
  if (!hasBakingContext(recipe)) return normalized;

  const stepText = recipeText({ steps: recipe?.steps || [] });
  const additions = [];
  for (const rule of BAKING_TOOL_RULES) {
    if (!rule.pattern.test(stepText)) continue;
    if (toolExists([...normalized, ...additions], rule)) continue;
    additions.push({
      name: rule.name,
      purpose: rule.purpose,
      essential: true,
      substitute: rule.substitute,
      substitute_note: rule.substitute_note,
      inferred: true,
    });
  }
  return [...normalized, ...additions];
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

const RECIPE_CARD_SOURCE_NOTE = "出处：画面配方卡";
const AMOUNT_TOKEN_RE = /\d+(?:\.\d+)?\s*(?:kg|千克|公斤|g|克|ml|毫升|L|升|个|只|枚|颗|勺|匙|杯|份)/gi;

function normalizeAmountText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/公斤|千克/g, "kg")
    .replace(/毫升/g, "ml")
    .replace(/克/g, "g")
    .replace(/升/g, "l")
    .replace(/\s+/g, "");
}

function amountTokens(...values) {
  const tokens = new Set();
  for (const value of values) {
    for (const match of String(value || "").match(AMOUNT_TOKEN_RE) || []) {
      tokens.add(normalizeAmountText(match));
    }
  }
  return [...tokens].filter(Boolean);
}

function ingredientNameAliases(name) {
  const normalized = normalizeAmountText(name);
  const aliases = new Set([normalized]);
  const pairs = [
    ["高筋面粉", "高粉"],
    ["中筋面粉", "中粉"],
    ["低筋面粉", "低粉"],
    ["白砂糖", "砂糖"],
  ];
  for (const [full, short] of pairs) {
    const a = normalizeAmountText(full);
    const b = normalizeAmountText(short);
    if (normalized.includes(a)) aliases.add(b);
    if (normalized.includes(b)) aliases.add(a);
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function recipeCardLines(cardTranscript) {
  return String(cardTranscript || "")
    .split(/\r?\n/)
    .map((line) => normalizeAmountText(line))
    .filter(Boolean);
}

function looksLikeIngredientAmountLine(line) {
  return /^[\u4e00-\u9fffA-Za-z（）()、/]{1,20}[:：]/.test(String(line || ""));
}

function recipeCardLineHasAmount(lines, aliases, tokens) {
  if (!aliases.length || !tokens.length) return false;
  for (let i = 0; i < lines.length; i++) {
    if (!aliases.some((alias) => lines[i].includes(alias))) continue;
    if (tokens.some((token) => lines[i].includes(token))) return true;
    const continuation = [lines[i - 1], lines[i + 1]]
      .filter((line) => line && !looksLikeIngredientAmountLine(line))
      .join("");
    if (tokens.some((token) => continuation.includes(token))) return true;
  }
  return false;
}

function appendRecipeCardSource(note) {
  const current = cleanText(note, 240);
  if (current.includes(RECIPE_CARD_SOURCE_NOTE)) return current;
  return current ? `${current}；${RECIPE_CARD_SOURCE_NOTE}` : RECIPE_CARD_SOURCE_NOTE;
}

export function annotateRecipeCardSources(recipe, cardTranscript) {
  if (!recipe || typeof recipe !== "object" || !Array.isArray(recipe.ingredients)) return recipe;
  const lines = recipeCardLines(cardTranscript);
  if (!lines.join("").includes(normalizeAmountText("【画面配方卡】"))) return recipe;

  for (const ing of recipe.ingredients) {
    if (!ing || typeof ing !== "object" || Array.isArray(ing)) continue;
    const qtyUnit = Number.isFinite(Number(ing.qty)) && ing.unit ? `${ing.qty}${ing.unit}` : "";
    const tokens = amountTokens(ing.amount, qtyUnit);
    const aliases = ingredientNameAliases(ing.name);
    if (recipeCardLineHasAmount(lines, aliases, tokens)) {
      ing.note = appendRecipeCardSource(ing.note);
    }
  }
  return recipe;
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
    s.index = i + 1;
    if (!isObj(s.params)) s.params = {};
    const st = normalizeSourceTime(s.source_time);
    if (st) s.source_time = st;
    else delete s.source_time;
  });
  recipe.ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter(isObj);
  applyIngredientFixes(recipe);
  annotateRecipeCardSources(recipe, cardTranscript);
  recipe.tools = inferBakingToolFallback(recipe, recipe.tools);
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
