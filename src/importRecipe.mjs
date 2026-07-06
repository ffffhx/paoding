function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function cleanText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(v)) return v.map(cleanText).filter(Boolean).join("、");
  if (isObj(v)) return cleanText(v.text ?? v.name ?? v["@value"] ?? v.value);
  return "";
}

function hasType(node, type) {
  return arr(node?.["@type"]).map(cleanText).some((t) => t.toLowerCase() === type.toLowerCase());
}

export function parseJsonLd(input) {
  if (typeof input === "string") return JSON.parse(input);
  return input;
}

export function findRecipeNode(input) {
  const root = parseJsonLd(input);
  const queue = arr(root);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (!isObj(node)) continue;
    if (hasType(node, "Recipe")) return node;
    queue.push(...arr(node["@graph"]));
  }
  return null;
}

export function parseIsoDurationMinutes(value) {
  const s = cleanText(value);
  if (!s) return null;
  if (Number.isFinite(Number(s))) return Math.max(0, Number(s));
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
  const minutes = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return Math.round(minutes * 10) / 10;
}

function splitTags(...values) {
  const out = [];
  for (const v of values) {
    for (const s of arr(v).flatMap((x) => cleanText(x).split(/[,，、;/|]+/))) {
      const t = s.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 8);
}

function parseIngredient(text) {
  const raw = cleanText(text);
  if (!raw) return null;
  let name = raw, amount = "";
  const spaced = raw.match(/^(.+?)\s+(.+)$/);
  const compact = raw.match(/^(.+?)(\d+(?:\.\d+)?\s*[\p{Script=Han}a-zA-Z%]*)$/u);
  if (spaced) { name = spaced[1].trim(); amount = spaced[2].trim(); }
  else if (compact) { name = compact[1].trim(); amount = compact[2].trim(); }
  return { name, amount, qty: null, unit: "", note: "" };
}

function normalizeIngredient(item) {
  if (isObj(item)) {
    const name = cleanText(item.name) || cleanText(item.food);
    const amount = cleanText(item.amount ?? item.quantity ?? item.value);
    if (!name && !amount) return null;
    return { name: name || amount, amount, qty: null, unit: "", note: cleanText(item.description) };
  }
  return parseIngredient(item);
}

function instructionText(node) {
  if (typeof node === "string") return node;
  if (!isObj(node)) return "";
  return cleanText(node.text ?? node.description ?? node.name);
}

function collectInstructionNodes(value, sectionName = "") {
  const out = [];
  for (const node of arr(value)) {
    if (!node) continue;
    if (typeof node === "string") {
      const parts = node.split(/\n+/).map(cleanText).filter(Boolean);
      out.push(...(parts.length ? parts : [cleanText(node)]).map((text) => ({ title: "", action: text })));
      continue;
    }
    if (!isObj(node)) continue;
    if (hasType(node, "HowToSection")) {
      const nextSection = cleanText(node.name) || sectionName;
      out.push(...collectInstructionNodes(node.itemListElement ?? node.steps, nextSection));
      continue;
    }
    if (node.itemListElement && !hasType(node, "HowToStep")) {
      out.push(...collectInstructionNodes(node.itemListElement, sectionName));
      continue;
    }
    const title = cleanText(node.name) || sectionName;
    const action = instructionText(node) || title;
    if (action) out.push({ title, action });
  }
  return out;
}

function normalizeNutrition(raw) {
  if (!isObj(raw)) return null;
  const num = (v) => {
    const m = cleanText(v).match(/-?\d+(?:\.\d+)?/);
    return m ? Math.round(Number(m[0]) * 10) / 10 : null;
  };
  const per = {
    calories_kcal: num(raw.calories),
    protein_g: num(raw.proteinContent),
    fat_g: num(raw.fatContent),
    carbs_g: num(raw.carbohydrateContent),
    sodium_mg: num(raw.sodiumContent),
  };
  if (!Object.values(per).some((v) => v != null)) return null;
  return { per_serving: per, disclaimer: "来自外部 JSON-LD，未由庖丁估算。", estimated: false };
}

export function mapSchemaRecipeToPaoding(input, { now = () => new Date().toISOString() } = {}) {
  const node = findRecipeNode(input);
  if (!node) throw Object.assign(new Error("未找到 schema.org Recipe"), { statusCode: 400 });

  const total = parseIsoDurationMinutes(node.totalTime);
  const prep = parseIsoDurationMinutes(node.prepTime);
  const cook = parseIsoDurationMinutes(node.cookTime);
  const instructions = collectInstructionNodes(node.recipeInstructions);
  const nutrition = normalizeNutrition(node.nutrition);
  const recipe = {
    title: cleanText(node.name) || "未命名导入菜谱",
    servings: cleanText(node.recipeYield ?? node.yield) || null,
    total_time_min: total ?? ((prep != null || cook != null) ? Math.round(((prep || 0) + (cook || 0)) * 10) / 10 : null),
    difficulty: null,
    cuisine: cleanText(node.recipeCuisine) || "",
    tags: splitTags(node.keywords, node.recipeCategory),
    ingredients: arr(node.recipeIngredient).map(normalizeIngredient).filter(Boolean),
    steps: instructions.map((s, i) => ({
      index: i + 1,
      title: s.title || `第 ${i + 1} 步`,
      action: s.action || s.title || "",
      params: {},
    })),
    source: cleanText(node.url ?? node.sameAs) || "",
    imported: true,
    created_at: now(),
  };
  if (nutrition) recipe.nutrition = nutrition;
  return recipe;
}
