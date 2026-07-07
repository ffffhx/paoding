import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSchemaRecipeToPaoding, findRecipeNode, parseIsoDurationMinutes } from "../src/importRecipe.mjs";

const fixedNow = () => "2026-07-07T00:00:00.000Z";

test("schema.org Recipe 标准 JSON-LD 映射成庖丁菜谱且不臆造 why", () => {
  const r = mapSchemaRecipeToPaoding({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "番茄炒蛋",
    recipeYield: "2人份",
    totalTime: "PT15M",
    recipeCuisine: "家常菜",
    keywords: "快手,下饭",
    recipeIngredient: ["鸡蛋 3个", "番茄2个"],
    tool: [{ "@type": "HowToTool", name: "不粘锅", description: "炒蛋防粘" }],
    recipeInstructions: [{ "@type": "HowToStep", name: "炒蛋", text: "鸡蛋炒散后盛出。" }],
    nutrition: { "@type": "NutritionInformation", calories: "220 kcal", proteinContent: "12 g" },
    url: "https://example.com/recipe",
  }, { now: fixedNow });

  assert.equal(r.title, "番茄炒蛋");
  assert.equal(r.servings, "2人份");
  assert.equal(r.total_time_min, 15);
  assert.deepEqual(r.tags, ["快手", "下饭"]);
  assert.equal(r.ingredients[0].name, "鸡蛋");
  assert.equal(r.ingredients[0].amount, "3个");
  assert.deepEqual(r.tools, [{
    name: "不粘锅",
    purpose: "炒蛋防粘",
    essential: true,
    substitute: null,
    substitute_note: "外部 JSON-LD 未提供替代信息。",
    inferred: false,
  }]);
  assert.equal(r.steps[0].title, "炒蛋");
  assert.equal(r.steps[0].action, "鸡蛋炒散后盛出。");
  assert.equal(r.steps[0].why, undefined);
  assert.equal(r.steps[0].confidence, undefined);
  assert.equal(r.steps[0].source_time, undefined);
  assert.equal(r.imported, true);
  assert.equal(r.nutrition.per_serving.calories_kcal, 220);
  assert.equal(r.created_at, "2026-07-07T00:00:00.000Z");
});

test("@graph 包裹时能找到 Recipe 节点", () => {
  const doc = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Person", name: "作者" },
      { "@type": ["Recipe"], name: "图谱菜", recipeInstructions: "切菜\n下锅" },
    ],
  };
  assert.equal(findRecipeNode(doc).name, "图谱菜");
  const r = mapSchemaRecipeToPaoding(doc, { now: fixedNow });
  assert.equal(r.title, "图谱菜");
  assert.deepEqual(r.steps.map(s => s.action), ["切菜", "下锅"]);
});

test("HowToSection 嵌套步骤会被拍平", () => {
  const r = mapSchemaRecipeToPaoding({
    "@type": "Recipe",
    name: "嵌套菜",
    prepTime: "PT10M",
    cookTime: "PT20M",
    recipeInstructions: [
      { "@type": "HowToSection", name: "准备", itemListElement: [{ "@type": "HowToStep", name: "切菜", text: "青菜切段。" }] },
      { "@type": "HowToSection", name: "烹饪", itemListElement: [{ "@type": "HowToStep", text: "大火炒熟。" }] },
    ],
  }, { now: fixedNow });
  assert.equal(r.total_time_min, 30);
  assert.deepEqual(r.steps.map(s => s.title), ["切菜", "烹饪"]);
  assert.deepEqual(r.steps.map(s => s.action), ["青菜切段。", "大火炒熟。"]);
});

test("脏 Recipe 数据不崩溃；非 Recipe 明确报错", () => {
  assert.doesNotThrow(() => mapSchemaRecipeToPaoding({
    "@type": "Recipe",
    recipeIngredient: [null, 42, { bad: "x" }],
    recipeInstructions: [null, { "@type": "HowToSection", itemListElement: [123, { "@type": "HowToStep", text: 456 }] }],
  }, { now: fixedNow }));
  assert.throws(() => mapSchemaRecipeToPaoding({ "@type": "Thing", name: "x" }), /未找到 schema\.org Recipe/);
  assert.equal(parseIsoDurationMinutes("P1D"), 1440);
});
