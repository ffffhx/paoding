import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  vm.runInContext(code, ctx, { filename: "app.js" });
  return ctx;
}

const app = loadApp();

test("scaledAmount 结构化优先，文本兜底", () => {
  assert.equal(app.scaledAmount({ qty: 3, unit: "个" }, 2), "6个");
  assert.equal(app.scaledAmount({ qty: 1, unit: "勺" }, 1.5), "1.5勺");
  assert.equal(app.scaledAmount({ qty: null, amount: "适量" }, 2), "适量");
  assert.equal(app.scaledAmount({ amount: "500克" }, 2), "1000克");
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

test("recipeToCooklang 元数据+结构化食材+步骤", () => {
  const cook = app.recipeToCooklang({ title: "蛋", tags: ["家常"], ingredients: [{ name: "鸡蛋", qty: 3, unit: "个" }, { name: "盐", amount: "适量" }], steps: [{ title: "炒", action: "下锅" }] });
  assert.ok(cook.includes(">> title: 蛋"));
  assert.ok(cook.includes("@鸡蛋{3%个}"));
  assert.ok(cook.includes("下锅"));
});

test("recipeToSchemaOrg 合法 Recipe JSON-LD", () => {
  const j = app.recipeToSchemaOrg({
    title: "蛋",
    ingredients: [{ name: "鸡蛋", amount: "3个" }],
    steps: [{ title: "炒", action: "下锅" }],
    nutrition: { per_serving: { calories_kcal: 180, protein_g: 12, fat_g: 10, carbs_g: 4, sodium_mg: 600 } },
  });
  assert.equal(j["@type"], "Recipe");
  assert.equal(j.name, "蛋");
  assert.ok(j.recipeIngredient.includes("鸡蛋 3个"));
  assert.equal(j.recipeInstructions[0]["@type"], "HowToStep");
  assert.equal(j.nutrition["@type"], "NutritionInformation");
  assert.equal(j.nutrition.calories, "180 kcal");
});

test("nutritionHtml 按份量系数缩放显示", () => {
  const html = app.nutritionHtml({ nutrition: { per_serving: { calories_kcal: 100, protein_g: 8, fat_g: 3, carbs_g: 12, sodium_mg: 200 }, disclaimer: "估算" } }, 1.5);
  assert.ok(html.includes("150 kcal"));
  assert.ok(html.includes("12 g"));
  assert.ok(html.includes("AI 估算"));
});

test("sourceSegmentUrl 按平台生成原视频时间戳链接", () => {
  assert.equal(app.sourceSegmentUrl("https://www.bilibili.com/video/BV1xx?p=2", [83.9, 120]), "https://www.bilibili.com/video/BV1xx?p=2&t=83");
  assert.equal(app.sourceSegmentUrl("https://www.youtube.com/watch?v=abc", [65, 90]), "https://www.youtube.com/watch?v=abc&t=65s");
  assert.equal(app.sourceSegmentUrl("https://youtu.be/abc", [12, 30]), "https://youtu.be/abc?t=12s");
  assert.equal(app.sourceSegmentUrl("https://www.douyin.com/video/123", [8, 18]), "https://www.douyin.com/video/123");
  assert.equal(app.sourceSegmentUrl("https://www.bilibili.com/video/BV1xx", null), "");
  assert.equal(app.sourceSegmentUrl("", [1, 2]), "");
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

test("mergeUserDataConflict 按字段合并跨设备数据", () => {
  const merged = app.mergeUserDataConflict({
    rev: 3,
    favRecipes: ["a"],
    favSteps: [{ key: "a#1", title: "A" }],
    shopping: [{ name: "盐", amount: "1勺", from: "A", checked: false }],
    meta: { a: { notes: "旧", ingChecked: [1], cooked: true, cooked_at: "2026-01-01T00:00:00.000Z" } },
    mealPlan: { "2026-01-01": ["a"] },
  }, {
    favRecipes: ["b", "a"],
    favSteps: [{ key: "b#1", title: "B" }, { key: "a#1", title: "A2" }],
    shopping: [{ name: "盐", amount: "1勺", from: "A", checked: true }, { name: "糖", amount: "2勺", from: "B" }],
    meta: { a: { notes: "新", ingChecked: [2], cooked_at: "2026-01-02T00:00:00.000Z" } },
    mealPlan: { "2026-01-01": ["b", "a"] },
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
});
