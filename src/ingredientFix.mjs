const INGREDIENT_TYPO_MAP = new Map([
  ["白纸", "白芷"],
  ["白直", "白芷"],
  ["百纸", "白芷"],
  ["百芷", "白芷"],
  ["肉豆扣", "肉豆蔻"],
  ["肉豆寇", "肉豆蔻"],
  ["肉蔻", "肉豆蔻"],
  ["草扣", "草蔻"],
  ["草寇", "草蔻"],
  ["山奈", "山柰"],
  ["山耐", "山柰"],
  ["三奈", "山柰"],
  ["必拨", "荜拨"],
  ["毕拨", "荜拨"],
  ["毕勃", "荜拨"],
  ["成皮", "陈皮"],
  ["沉皮", "陈皮"],
  ["钉香", "丁香"],
  ["丁相", "丁香"],
  ["沙仁", "砂仁"],
  ["杀仁", "砂仁"],
  ["贵皮", "桂皮"],
  ["桂披", "桂皮"],
  ["巴角", "八角"],
  ["八脚", "八角"],
  ["花教", "花椒"],
  ["花交", "花椒"],
  ["资然", "孜然"],
  ["自然粉", "孜然粉"],
  ["凉姜", "良姜"],
  ["梁姜", "良姜"],
  ["干草", "甘草"],
  ["赶草", "甘草"],
  ["黄奇", "黄芪"],
  ["黄旗", "黄芪"],
  ["当规", "当归"],
  ["党生", "党参"],
  ["罗汉锅", "罗汉果"],
  ["豆扣", "豆蔻"],
  ["豆寇", "豆蔻"],
]);

const SORTED_TYPOS = [...INGREDIENT_TYPO_MAP.keys()].sort((a, b) => b.length - a.length);

export function replaceIngredientTypos(text, typos = SORTED_TYPOS) {
  let out = String(text ?? "");
  const ordered = [...typos].filter((typo) => INGREDIENT_TYPO_MAP.has(typo)).sort((a, b) => b.length - a.length);
  for (const typo of ordered) out = out.replaceAll(typo, INGREDIENT_TYPO_MAP.get(typo));
  return out;
}

export function fixIngredientName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return { name: raw, corrected: false };
  const fixed = replaceIngredientTypos(raw);
  return fixed === raw ? { name: raw, corrected: false } : { name: fixed, corrected: true, original: raw };
}

function correctionNote(original) {
  return `转写作「${original}」，已按烹饪常识纠正。`;
}

function appendCorrectionNote(note, original) {
  const add = correctionNote(original);
  const current = String(note || "").trim();
  if (current.includes(add)) return current;
  return current ? `${current}；${add}` : add;
}

export function applyIngredientFixes(recipe) {
  if (!recipe || typeof recipe !== "object") return recipe;
  const correctedTypos = new Set();
  if (Array.isArray(recipe.ingredients)) {
    for (const ing of recipe.ingredients) {
      if (!ing || typeof ing !== "object" || Array.isArray(ing)) continue;
      const fixed = fixIngredientName(ing.name);
      if (!fixed.corrected) continue;
      ing.name = fixed.name;
      ing.note = appendCorrectionNote(ing.note, fixed.original);
      for (const typo of SORTED_TYPOS) {
        if (fixed.original.includes(typo)) correctedTypos.add(typo);
      }
    }
  }
  if (!correctedTypos.size) return recipe;
  if (Array.isArray(recipe.steps)) {
    for (const step of recipe.steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      for (const key of ["title", "action"]) {
        if (step[key]) step[key] = replaceIngredientTypos(step[key], correctedTypos);
      }
      if (step.params && typeof step.params === "object" && !Array.isArray(step.params)) {
        for (const key of ["heat", "temp", "time", "cue"]) {
          if (step.params[key]) step.params[key] = replaceIngredientTypos(step.params[key], correctedTypos);
        }
      }
    }
  }
  return recipe;
}
