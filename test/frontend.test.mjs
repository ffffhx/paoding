import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const i18nCode = fs.readFileSync(path.join(HERE, "../app/i18n.js"), "utf8");
const code = fs.readFileSync(path.join(HERE, "../app/app.js"), "utf8");

// app.js 是经典脚本、满是浏览器 API。造一套最小桩，在 vm 里跑起来，取出里面定义的纯函数来测。
function loadApp() {
  const noop = () => {};
  const mem = {};
  const elStub = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, remove: noop, textContent: "", innerHTML: "", firstElementChild: null });
  const doc = { addEventListener: noop, createElement: () => elStub(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, documentElement: { setAttribute: noop, style: { setProperty: noop } }, body: elStub() };
  const ctx = {
    document: doc,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } },
    location: { pathname: "/", origin: "http://localhost", search: "" },
    navigator: { serviceWorker: { register: () => ({ then: () => ({ catch: noop }) }), addEventListener: noop } },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    performance: { now: () => 0 },
    URL, URLSearchParams,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(i18nCode, ctx, { filename: "i18n.js" });
  vm.runInContext(code, ctx, { filename: "app.js" });
  return ctx;
}

const app = loadApp();

test("i18n t 回退 en→zh→key，并支持参数替换", () => {
  app.PaodingI18n.en["test.hello"] = "Hello {name}";
  app.PaodingI18n.zh["test.onlyZh"] = "只有 {name}";
  app.PaodingI18n.setLang("en");
  assert.equal(app.t("test.hello", { name: "Ada" }), "Hello Ada");
  assert.equal(app.t("test.onlyZh", { name: "庖丁" }), "只有 庖丁");
  assert.equal(app.t("test.missing"), "test.missing");
  app.setLanguage("zh");
});

test("settingsLanguageRowHtml 切 en 后关键 UI 字符串是英文", () => {
  app.setLanguage("en");
  const html = app.settingsLanguageRowHtml();
  assert.ok(html.includes("Language"));
  assert.ok(html.includes("Switch the interface language"));
  assert.ok(html.includes("Chinese"));
  assert.equal(app.t("settings.theme.label"), "Dark mode");
  assert.equal(app.t("settings.backend.placeholder"), "e.g. http://192.168.1.5:4177");
  assert.equal(app.t("settings.importRecipe.submit"), "Import recipe");
  app.setLanguage("zh");
});

test("安装横幅切 en 后使用英文文案", () => {
  app.setLanguage("en");
  assert.equal(app.t("install.prompt"), "Install Paoding to your home screen and use it like an app");
  assert.equal(app.t("install.action"), "Install");
  app.setLanguage("zh");
});

test("标签编辑弹窗切 en 后使用英文文案", () => {
  app.setLanguage("en");
  assert.equal(app.t("tag.edit.title"), "Edit tags");
  assert.equal(app.t("tag.edit.placeholder"), "home, quick, weeknight");
  assert.equal(app.t("tag.edit.empty"), "No tags");
  assert.equal(app.t("tag.edit.save"), "Save");
  app.setLanguage("zh");
});

test("首页/列表文案切 en 后使用英文标签", () => {
  app.setLanguage("en");
  assert.deepEqual(Array.from(app.homeFilterChips(["家常"]).slice(0, 6).map((x) => x[1])), [
    "All",
    "★ Favorited",
    "✓ Cooked",
    "Not cooked",
    "Has nutrition",
    "家常",
  ]);
  assert.equal(app.recipeListTimeText(15), "⏱ about 15 min");
  assert.equal(app.recipeListTimeText(null, "time"), "⏱ unknown");
  assert.equal(app.difficultyLabel("hard"), "Challenging");
  assert.equal(app.recentJobTypeLabel({ type: "images" }), "Images");
  assert.equal(app.recentJobStatusLabel({ status: "interrupted" }), "Interrupted");
  assert.equal(app.recentJobTitle({ type: "text", params: { input: "番茄炒蛋" } }), "Pasted text");
  app.setLanguage("zh");
});

test("toast 和错误提示切 en 后输出英文文案", () => {
  app.setLanguage("en");
  assert.equal(app.stageLabel("vision"), "Read images/video frames");
  assert.equal(app.stageLabel("unknown", "Custom stage"), "Custom stage");
  assert.equal(app.t("backup.restored", { count: 2 }), "Restored 2 recipes. Refreshing…");
  assert.equal(app.t("parse.failed", { message: "boom" }), "Parse failed: boom");
  assert.equal(app.t("timer.notification.body", { label: "Egg" }), "Egg is done!");
  app.setLanguage("zh");
});

test("scaledAmount 结构化优先，文本兜底", () => {
  assert.equal(app.scaledAmount({ qty: 3, unit: "个" }, 2), "6个");
  assert.equal(app.scaledAmount({ qty: 1, unit: "勺" }, 1.5), "1.5勺");
  assert.equal(app.scaledAmount({ qty: null, amount: "适量" }, 2), "适量");
  assert.equal(app.scaledAmount({ amount: "500克" }, 2), "1000克");
});

test("phase 菜谱分组、双缩放和购物清单换算", () => {
  const recipe = {
    title: "茉莉奶绿",
    batch_info: { yield: "一壶茶汤（约1300毫升）", makes_servings: 4, makes_note: "按每杯250毫升推算（推算）" },
    ingredients: [
      { name: "茉莉茶叶", qty: 20, unit: "克", amount: "20克", phase: "batch" },
      { name: "热水", qty: 1300, unit: "毫升", amount: "1300毫升", phase: "batch" },
      { name: "茶汤", qty: 250, unit: "毫升", amount: "250毫升", phase: "serving" },
      { name: "牛奶", qty: 100, unit: "毫升", amount: "100毫升", phase: "serving" },
    ],
    steps: [
      { index: 1, title: "泡茶", action: "泡茶汤", phase: "batch" },
      { index: 2, title: "组装", action: "加入茶汤和牛奶", phase: "serving" },
    ],
  };
  const groups = app.recipePhaseGroups(recipe);
  assert.equal(groups.hasPhases, true);
  assert.deepEqual(Array.from(groups.ingredients.batch.map(x => x.item.name)), ["茉莉茶叶", "热水"]);
  assert.equal(app.scaledIngredientAmount(recipe.ingredients[0], { batchFactor: 2, servingFactor: 3 }), "40克");
  assert.equal(app.scaledIngredientAmount(recipe.ingredients[3], { batchFactor: 2, servingFactor: 3 }), "300毫升");
  assert.equal(app.batchInfoText(recipe, 2), "一壶茶汤（约1300毫升） · 约供 8 份 · 按每杯250毫升推算（推算）");

  const items = app.shoppingItemsForRecipe(recipe, { batchFactor: 2, servingFactor: 3 });
  assert.deepEqual(Array.from(items.map(x => `${x.name}:${x.amount}`)), [
    "茉莉茶叶:40克",
    "热水:2600毫升",
    "茶汤:750毫升",
    "牛奶:300毫升",
  ]);

  const cookSteps = app.cookStepsForRecipe(recipe);
  assert.equal(cookSteps.length, 3);
  assert.equal(cookSteps[1].divider, true);
  assert.equal(cookSteps[2].title, "组装");

  const partial = app.recipePhaseGroups({
    ingredients: [{ name: "茶叶", phase: "batch" }, { name: "牛奶" }],
    steps: [{ title: "做", phase: "batch" }],
  });
  assert.equal(partial.hasPhases, false);
  assert.equal(partial.ingredients.batch.length, 2);
  assert.equal(app.cookStepsForRecipe({ steps: [{ index: 1, title: "普通", action: "做" }] }).length, 1);
});

test("unitReferencesFor 匹配中餐常用单位并避免英文误命中", () => {
  const units = app.unitReferencesFor("生抽 2勺，水 100ml，肉 2两").map(ref => ref.unit);
  assert.deepEqual(Array.from(units), ["勺", "两", "毫升"]);
  assert.equal(app.unitReferencesFor("白糖 50g")[0].unit, "克");
  assert.deepEqual(Array.from(app.unitReferencesFor("生抽 两勺").map(ref => ref.unit)), ["勺"]);
  assert.deepEqual(Array.from(app.unitReferencesFor("盐 两克").map(ref => ref.unit)), ["克"]);
  assert.deepEqual(Array.from(app.unitReferencesFor("水 两毫升").map(ref => ref.unit)), ["毫升"]);
  assert.deepEqual(Array.from(app.unitReferencesFor("egg").map(ref => ref.unit)), []);
});

test("unitLookupText 输出静态换算速查文本", () => {
  const text = app.unitLookupText("15毫升 1瓷勺");
  assert.ok(text.includes("毫升："));
  assert.ok(text.includes("勺："));
  assert.ok(text.includes("1瓷勺/汤匙≈15毫升"));
  assert.ok(text.includes("1毫升水≈1克"));
  assert.equal(app.unitLookupText("适量"), "");
});

test("mergeAmounts 同单位求和，异单位并列", () => {
  assert.equal(app.mergeAmounts(["500克", "300克"]), "800克");
  assert.equal(app.mergeAmounts(["3勺", "2勺"]), "5勺");
  assert.ok(app.mergeAmounts(["三勺", "四勺"]).includes("三勺"));
});

test("shopCat 货架分区映射", () => {
  assert.equal(app.shopCat("苹果"), "蔬菜水果");
  assert.equal(app.shopCat("鸡蛋"), "肉禽蛋");
  assert.equal(app.shopCat("鲜虾"), "水产");
  assert.equal(app.shopCat("酱油"), "调味干货");
  assert.equal(app.shopCat("面条"), "粮油米面");
  assert.equal(app.shopCat("豆腐"), "乳品豆制品");
  assert.equal(app.shopCat("冷冻水饺"), "冷冻");
  assert.equal(app.shopCat("某种没见过的东西"), "其他");
});

test("parseSeconds 中文时长解析", () => {
  assert.equal(app.parseSeconds("5分钟"), 300);
  assert.equal(app.parseSeconds("1小时30分钟"), 5400);
  assert.equal(app.parseSeconds("30秒"), 30);
  assert.equal(app.parseSeconds(""), 0);
});

test("mergeCookTimeline 将被动等待窗口让给另一道菜", () => {
  const timeline = app.mergeCookTimeline([
    {
      title: "红烧肉",
      steps: [
        { index: 1, title: "煸炒", action: "五花肉煸炒出油", params: { time: "5分钟" } },
        { index: 2, title: "炖煮", action: "加水小火炖煮", params: { time: "20分钟" } },
        { index: 3, title: "收汁", action: "大火收汁", params: { time: "2分钟" } },
      ],
    },
    {
      title: "清炒青菜",
      steps: [
        { index: 1, title: "洗菜", action: "青菜洗净沥干", params: { time: "4分钟" } },
        { index: 2, title: "快炒", action: "大火快炒", params: { time: "5分钟" } },
      ],
    },
  ]);
  const wait = timeline.find(x => x.recipeTitle === "红烧肉" && x.stepIndex === 2);
  const greens = timeline.filter(x => x.recipeTitle === "清炒青菜");
  const finish = timeline.find(x => x.recipeTitle === "红烧肉" && x.stepIndex === 3);
  assert.equal(wait.passive, true);
  assert.ok(greens.every(x => x.offsetMin > wait.offsetMin && x.offsetMin < finish.offsetMin));
});

test("mergeCookTimeline 无时长步骤使用 3 分钟估算", () => {
  const timeline = app.mergeCookTimeline([{ title: "凉拌黄瓜", steps: [{ index: 1, title: "拌", action: "拌匀装盘" }] }]);
  assert.equal(timeline[0].offsetMin, 0);
  assert.equal(timeline[0].durationMin, 3);
  assert.equal(timeline[0].estimated, true);
});

test("mergeCookTimeline 单菜退化为原步骤顺序", () => {
  const timeline = app.mergeCookTimeline([{
    title: "蒸蛋",
    steps: [
      { index: 1, title: "打蛋", action: "鸡蛋打散", params: { time: "2分钟" } },
      { index: 2, title: "蒸", action: "上锅蒸", params: { time: "8分钟" } },
      { index: 3, title: "调味", action: "淋生抽", params: { time: "1分钟" } },
    ],
  }]);
  assert.deepEqual(Array.from(timeline.map(x => x.stepIndex)), [1, 2, 3]);
  assert.deepEqual(Array.from(timeline.map(x => x.offsetMin)), [0, 2, 10]);
  assert.equal(timeline[1].passive, true);
});

test("moveItem 移动整步对象且不丢附属数据", () => {
  const steps = [
    { title: "切菜", source_time: [1, 3], image: "s1.jpg", why: { reason: "更均匀" } },
    { title: "下锅", source_time: [8, 12], image: "s2.jpg", why: { reason: "先爆香" } },
  ];
  const moved = app.moveItem(steps, 0, 1);
  assert.equal(moved[1], steps[0]);
  assert.equal(moved[1].image, "s1.jpg");
  assert.deepEqual(Array.from(moved[1].source_time), [1, 3]);
  assert.equal(moved[1].why.reason, "更均匀");
  assert.deepEqual(Array.from(steps.map(x => x.title)), ["切菜", "下锅"]);
});

test("insertItem/removeItem 返回新数组并支持边界下标", () => {
  const base = ["a", "c"];
  const inserted = app.insertItem(base, 1, "b");
  assert.deepEqual(Array.from(inserted), ["a", "b", "c"]);
  assert.deepEqual(Array.from(base), ["a", "c"]);
  assert.deepEqual(Array.from(app.removeItem(inserted, 1)), ["a", "c"]);
  assert.deepEqual(Array.from(app.insertItem(base, 99, "z")), ["a", "c", "z"]);
  assert.deepEqual(Array.from(app.removeItem(base, 99)), ["a", "c"]);
});

test("recipeToCooklang 元数据+结构化食材+步骤", () => {
  const cook = app.recipeToCooklang({ title: "蛋", tags: ["家常"], ingredients: [{ name: "鸡蛋", qty: 3, unit: "个" }, { name: "盐", amount: "适量" }], steps: [{ title: "炒", action: "下锅" }] });
  assert.ok(cook.includes(">> title: 蛋"));
  assert.ok(cook.includes("-- 食材\n"));
  assert.ok(cook.includes("-- 做法\n1. 炒：下锅"));
  assert.ok(cook.includes("@鸡蛋{3%个}"));
  assert.ok(cook.includes("下锅"));
});

test("导出文件正文切 en 后使用英文标题、章节和 why", () => {
  app.setLanguage("en");
  const recipe = {
    title: "Egg",
    ingredients: [{ name: "egg", qty: 2, unit: "pcs" }],
    tools: [{ name: "Whisk", purpose: "Beat eggs", essential: true, substitute: null, substitute_note: "A fork cannot aerate as evenly", inferred: false }],
    steps: [{ index: 1, title: "Beat", action: "Beat eggs", why: { reason: "Even texture" } }],
  };
  const text = app.recipeToText(recipe, 1);
  assert.ok(text.startsWith("Egg\n"));
  assert.ok(text.includes("Tools needed"));
  assert.ok(text.includes("Whisk"));
  assert.ok(text.includes("No alternative"));
  assert.ok(text.includes("A fork cannot aerate as evenly"));
  assert.ok(text.includes("1. Beat: Beat eggs\n"));
  assert.ok(text.includes("   Why: Even texture\n"));

  const cook = app.recipeToCooklang(recipe);
  assert.ok(cook.includes("-- Ingredients\n"));
  assert.ok(cook.includes("-- Steps\n1. Beat: Beat eggs"));
  app.setLanguage("zh");
});

test("recipeToSchemaOrg 合法 Recipe JSON-LD", () => {
  const j = app.recipeToSchemaOrg({
    title: "蛋",
    ingredients: [{ name: "鸡蛋", amount: "3个" }],
    tools: [{ name: "电动打蛋器", purpose: "打发蛋白", essential: true, substitute: "手动打蛋器", substitute_note: "耗时更长", inferred: true }],
    steps: [{ title: "炒", action: "下锅" }],
    nutrition: { per_serving: { calories_kcal: 180, protein_g: 12, fat_g: 10, carbs_g: 4, sodium_mg: 600 } },
  });
  assert.equal(j["@type"], "Recipe");
  assert.equal(j.name, "蛋");
  assert.ok(j.recipeIngredient.includes("鸡蛋 3个"));
  assert.equal(j.recipeInstructions[0]["@type"], "HowToStep");
  assert.equal(j.tool[0]["@type"], "HowToTool");
  assert.equal(j.tool[0].name, "电动打蛋器");
  assert.match(j.tool[0].description, /Alternative: 手动打蛋器/);
  assert.equal(j.nutrition["@type"], "NutritionInformation");
  assert.equal(j.nutrition.calories, "180 kcal");
});

test("stepWhyPrintHtml 生成打印用 why 文本并转义", () => {
  const html = app.stepWhyPrintHtml({
    why: {
      reason: "让淀粉糊化",
      if_not: "容易夹生",
      cue: "边缘金黄<script>",
    },
  });
  assert.ok(html.includes("print-why"));
  assert.ok(html.includes("为什么"));
  assert.ok(html.includes("不这么做"));
  assert.ok(html.includes("判断到位"));
  assert.ok(html.includes("让淀粉糊化"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(app.stepWhyPrintHtml({}), "");
});

test("详情页 why/风险/单位速查切 en 后输出英文标签", () => {
  app.setLanguage("en");
  const html = app.stepWhyPrintHtml({
    why: { reason: "Gel starch", if_not: "Raw center", cue: "Golden<script>" },
  });
  assert.ok(html.includes("Why"));
  assert.ok(html.includes("If skipped"));
  assert.ok(html.includes("Doneness cue"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(app.riskBadge("high").includes("Beginner pitfall"));
  assert.ok(app.unitTipButtonHtml("15毫升").includes("Unit reference"));
  app.setLanguage("zh");
});

test("nutritionHtml 按份量系数缩放显示", () => {
  const html = app.nutritionHtml({ nutrition: { per_serving: { calories_kcal: 100, protein_g: 8, fat_g: 3, carbs_g: 12, sodium_mg: 200 }, disclaimer: "估算" } }, 1.5);
  assert.ok(html.includes("150 kcal"));
  assert.ok(html.includes("12 g"));
  assert.ok(html.includes("AI 估算"));
});

test("nutritionHtml 切 en 后输出英文营养标签", () => {
  app.setLanguage("en");
  const html = app.nutritionHtml({ nutrition: { per_serving: { calories_kcal: 100, protein_g: 8, fat_g: 3, carbs_g: 12, sodium_mg: 200 } } }, 1);
  assert.ok(html.includes("Nutrition per serving"));
  assert.ok(html.includes("AI estimate"));
  assert.ok(html.includes("Calories"));
  assert.ok(html.includes("Protein"));
  app.setLanguage("zh");
});

test("工具卡片和跟做工具提示支持替代与无替代原因", () => {
  app.setLanguage("en");
  const r = {
    tools: [
      { name: "Piping bag", purpose: "Pipe cream", essential: true, substitute: "Freezer bag with a cut corner", substitute_note: "Less precise edges", inferred: false },
      { name: "Chiffon pan", purpose: "Let batter climb while baking", essential: true, substitute: null, substitute_note: "A nonstick pan prevents the cake from climbing", inferred: true },
      { name: "<b>Offset spatula</b>", purpose: { text: "Smooth <i>cream</i>" }, essential: "1", substitute: { name: "Spoon" }, substitute_note: ["Less flat", "<script>bad()</script>"], inferred: "1" },
    ],
  };
  const html = app.toolsCardHtml(r);
  assert.ok(html.includes("Tools needed"));
  assert.ok(html.includes("Essential"));
  assert.ok(html.includes("Alternative: Freezer bag"));
  assert.ok(html.includes("Note: Less precise edges"));
  assert.ok(html.includes("No alternative"));
  assert.ok(html.includes("Reason: A nonstick pan prevents"));
  assert.ok(html.includes("Inferred"));
  assert.ok(html.includes("Offset spatula"));
  assert.ok(html.includes("Alternative: Spoon"));
  assert.ok(!html.includes("[object Object]"));
  assert.ok(!html.includes("<script>"));
  assert.equal(app.toolsCardHtml({ title: "old recipe" }), "");
  assert.deepEqual(app.stepToolsFor(r.tools, { title: "Decorate", action: "Use Piping bag to pipe cream" }).map(t => t.name), ["Piping bag"]);
  assert.ok(app.stepToolsHtml(r, { action: "Bake in Chiffon pan" }).includes("Tools for this step"));
  assert.ok(app.recipeToText(r, 1).includes("Offset spatula"));
  assert.ok(!app.recipeToText(r, 1).includes("[object Object]"));
  app.setLanguage("zh");
});

test("跟做模式辅助片段切 en 后输出英文 UI 文案", () => {
  app.setLanguage("en");
  assert.ok(app.paramsHtml({ heat: "medium", time: "3分钟", cue: "golden" }).includes("Heat"));
  assert.ok(app.paramsHtml({ heat: "medium", time: "3分钟", cue: "golden" }).includes("Time"));
  assert.ok(app.timerHtml({ time: "3分钟20秒" }).includes("Start timer (3m20s)"));
  assert.ok(app.usedIngsHtml({ ingredients: [{ name: "egg", amount: "2" }] }, { action: "beat egg" }).includes("Used in this step"));
  app.setLanguage("zh");
});

test("技法页辅助文案切 en 后输出英文 UI 文案", () => {
  app.setLanguage("en");
  assert.equal(app.techCountText(3), "3 uses");
  assert.equal(app.techCountText(3, true), "3 occurrences");
  assert.equal(app.techRecipeStepText("Mapo tofu", 2), "Mapo tofu · Step 2");
  assert.equal(app.techSamplesText([{ recipeTitle: "A" }, { recipeTitle: "B" }]), "A, B");
  assert.equal(app.techSummaryNoteText(true), "AI summary, for reference only · loaded from cache");
  assert.equal(app.t("skills.empty.title"), "Your saved tips are empty.");
  app.setLanguage("zh");
});

test("summarizeMealNutrition 按每道菜份量系数汇总并统计缺失", () => {
  const summary = app.summarizeMealNutrition([
    { id: "a", nutrition: { per_serving: { calories_kcal: 100, protein_g: 8, fat_g: 3, carbs_g: 12, sodium_mg: 200 } } },
    { id: "b", nutrition: { per_serving: { calories_kcal: 50, protein_g: 2, fat_g: 1, carbs_g: 9, sodium_mg: 80 } } },
    { id: "c" },
  ], { a: 1.5, b: 2 });
  assert.equal(summary.counted, 2);
  assert.equal(summary.missing, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.totals)), {
    calories_kcal: 250,
    protein_g: 16,
    fat_g: 6.5,
    carbs_g: 36,
    sodium_mg: 460,
  });
});

test("nutritionSummaryHtml 支持周日均和未估算提示", () => {
  const summary = app.summarizeMealNutrition([
    { id: "a", nutrition: { per_serving: { calories_kcal: 700, protein_g: 70, fat_g: 35, carbs_g: 140, sodium_mg: 700 } } },
    { id: "b" },
  ]);
  const html = app.nutritionSummaryHtml(summary, { prefix: "本周日均", averageBy: 7 });
  assert.ok(html.includes("本周日均"));
  assert.ok(html.includes("热量 100kcal"));
  assert.ok(html.includes("蛋白质 10g"));
  assert.ok(html.includes("1 道菜未估算"));
});

test("sourceSegmentUrl 按平台生成原视频时间戳链接", () => {
  assert.equal(app.sourceSegmentUrl("https://www.bilibili.com/video/BV1xx?p=2", [83.9, 120]), "https://www.bilibili.com/video/BV1xx?p=2&t=83");
  assert.equal(app.sourceSegmentUrl("https://www.youtube.com/watch?v=abc", [65, 90]), "https://www.youtube.com/watch?v=abc&t=65s");
  assert.equal(app.sourceSegmentUrl("https://youtu.be/abc", [12, 30]), "https://youtu.be/abc?t=12s");
  assert.equal(app.sourceSegmentUrl("https://www.douyin.com/video/123", [8, 18]), "https://www.douyin.com/video/123");
  assert.equal(app.sourceSegmentUrl("https://www.bilibili.com/video/BV1xx", null), "");
  assert.equal(app.sourceSegmentUrl("", [1, 2]), "");
});

test("normalizeRecipeListPayload 拒绝错误对象，避免渲染崩溃", () => {
  const list = [{ id: "a", title: "菜" }];
  assert.equal(app.normalizeRecipeListPayload(list), list);
  assert.throws(() => app.normalizeRecipeListPayload({ error: "未授权" }), /未授权/);
});

test("shareRecipeUrl 优先使用远程后端地址", () => {
  assert.equal(app.shareRecipeUrl("红烧肉", { origin: "https://cook.example", base: "" }), "https://cook.example/r/%E7%BA%A2%E7%83%A7%E8%82%89");
  assert.equal(app.shareRecipeUrl("红烧肉", { origin: "https://cook.example", base: "/paoding" }), "https://cook.example/paoding/r/%E7%BA%A2%E7%83%A7%E8%82%89");
  assert.equal(app.shareRecipeUrl("红烧肉", { apiBase: "http://192.168.1.5:4177/paoding/", origin: "capacitor://localhost", base: "" }), "http://192.168.1.5:4177/paoding/r/%E7%BA%A2%E7%83%A7%E8%82%89");
});

test("filterAndSortRecipes 支持食材 AND 筛选、快捷筛选和排序", () => {
  const list = [
    { id: "a", title: "番茄炒蛋", created_at: "2026-01-03T00:00:00.000Z", total_time: "PT15M", ingredients: [{ name: "番茄" }, { name: "鸡蛋" }], nutrition: { per_serving: { calories_kcal: 1 } } },
    { id: "b", title: "葱油面", created_at: "2026-01-04T00:00:00.000Z", ingredients: [{ name: "面条" }, { name: "小葱" }] },
    { id: "c", title: "白灼青菜", created_at: "2026-01-02T00:00:00.000Z", ingredients: [{ name: "青菜" }], steps: [{ params: { time: "5分钟" } }, { duration: "PT2M" }] },
  ];
  const ctx = { favRecipes: ["b"], meta: { a: { cooked: true, rating: 2 }, b: { rating: 5 } } };

  assert.deepEqual(app.filterAndSortRecipes(list, { ingredients: "鸡蛋, 番茄", sort: "name" }, ctx).map(r => r.id), ["a"]);
  assert.deepEqual(app.filterAndSortRecipes(list, { tag: "__fav" }, ctx).map(r => r.id), ["b"]);
  assert.deepEqual(app.filterAndSortRecipes(list, { tag: "__uncooked", sort: "name" }, ctx).map(r => r.id), ["c", "b"]);
  assert.deepEqual(app.filterAndSortRecipes(list, { tag: "__nutrition" }, ctx).map(r => r.id), ["a"]);
  assert.deepEqual(app.filterAndSortRecipes(list, { sort: "rating" }, ctx).map(r => r.id), ["b", "a", "c"]);
  assert.deepEqual(app.filterAndSortRecipes(list, { sort: "time" }, ctx).map(r => r.id), ["c", "a", "b"]);
});

test("groupShoppingItems 按货架分区、同名合并且已购沉底", () => {
  const groups = app.groupShoppingItems([
    { name: "酱油", amount: "1勺", from: "A", checked: true },
    { name: "西红柿", amount: "2个", from: "A", checked: true },
    { name: "牛肉", amount: "300克", from: "B", checked: false },
    { name: "西红柿", amount: "1个", from: "B", checked: false },
    { name: "冻虾仁", amount: "200克", from: "C", checked: false },
  ]);
  const sections = Array.from(groups).map((g) => g.section);
  assert.deepEqual(sections, ["蔬菜水果", "肉禽蛋", "调味干货", "冷冻"]);
  const veg = groups.find((g) => g.section === "蔬菜水果");
  assert.equal(veg.items[0].name, "西红柿");
  assert.equal(veg.items[0].amount, "3个");
  assert.equal(veg.items[0].checked, false);
  const text = app.shoppingTextBySection([
    { name: "牛肉", amount: "300克", from: "B", checked: false },
    { name: "酱油", amount: "1勺", from: "A", checked: true },
  ]);
  assert.ok(text.includes("【肉禽蛋】\n牛肉 300克"));
  assert.ok(text.includes("【调味干货】\n✓ 酱油 1勺"));
});

test("购物清单和计划摘要切 en 后输出英文 UI 文案", () => {
  app.setLanguage("en");
  const text = app.shoppingTextBySection([
    { name: "牛肉", amount: "300克", from: "B", checked: false },
    { name: "酱油", amount: "1勺", from: "A", checked: true },
  ]);
  assert.ok(text.includes("【Meat & Eggs】\n牛肉 300克"));
  assert.ok(text.includes("【Pantry & Seasonings】\n✓ 酱油 1勺"));

  const summary = app.summarizeMealNutrition([
    { id: "a", nutrition: { per_serving: { calories_kcal: 700, protein_g: 70, fat_g: 35, carbs_g: 140, sodium_mg: 700 } } },
    { id: "b" },
  ]);
  const html = app.nutritionSummaryHtml(summary, { prefix: app.t("plan.weekAverage"), averageBy: 7 });
  assert.ok(html.includes("Weekly daily avg"));
  assert.ok(html.includes("Calories 100kcal"));
  assert.ok(html.includes("1 not estimated"));
  assert.equal(app.weekDays()[0].label, "Today");
  assert.equal(app.weekDays()[1].label, "Tomorrow");
  app.setLanguage("zh");
});

test("mergeUserDataConflict 按字段合并跨设备数据", () => {
  const merged = app.mergeUserDataConflict({
    rev: 3,
    favRecipes: ["a"],
    favSteps: [{ key: "a#1", title: "A" }],
    shopping: [{ name: "盐", amount: "1勺", from: "A", checked: false }],
    meta: { a: { notes: "旧", ingChecked: [1], cooked: true, cooked_at: "2026-01-01T00:00:00.000Z" } },
    mealPlan: { "2026-01-01": ["a"] },
    settings: { lang: "zh" },
  }, {
    favRecipes: ["b", "a"],
    favSteps: [{ key: "b#1", title: "B" }, { key: "a#1", title: "A2" }],
    shopping: [{ name: "盐", amount: "1勺", from: "A", checked: true }, { name: "糖", amount: "2勺", from: "B" }],
    meta: { a: { notes: "新", ingChecked: [2], cooked_at: "2026-01-02T00:00:00.000Z" } },
    mealPlan: { "2026-01-01": ["b", "a"] },
    settings: { lang: "en" },
  });
  assert.equal(merged.rev, 3);
  assert.deepEqual(Array.from(merged.favRecipes), ["a", "b"]);
  assert.deepEqual(Array.from(merged.favSteps).map((x) => x.key), ["a#1", "b#1"]);
  assert.equal(merged.shopping.find((x) => x.name === "盐").checked, true);
  assert.ok(merged.shopping.some((x) => x.name === "糖"));
  assert.deepEqual(Array.from(merged.meta.a.ingChecked), [1, 2]);
  assert.equal(merged.meta.a.notes, "新");
  assert.equal(merged.meta.a.cooked, true);
  assert.equal(merged.meta.a.cooked_at, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(Array.from(merged.mealPlan["2026-01-01"]), ["a", "b"]);
  assert.equal(merged.settings.lang, "en");
});
