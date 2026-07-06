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
    URLSearchParams,
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

test("shopCat 品类归类", () => {
  assert.equal(app.shopCat("猪肉"), "🥩 肉蛋水产");
  assert.equal(app.shopCat("西红柿"), "🥬 蔬菜菌菇");
  assert.equal(app.shopCat("酱油"), "🧂 调料");
  assert.equal(app.shopCat("某种没见过的东西"), "🧺 其他");
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
  const j = app.recipeToSchemaOrg({ title: "蛋", ingredients: [{ name: "鸡蛋", amount: "3个" }], steps: [{ title: "炒", action: "下锅" }] });
  assert.equal(j["@type"], "Recipe");
  assert.equal(j.name, "蛋");
  assert.ok(j.recipeIngredient.includes("鸡蛋 3个"));
  assert.equal(j.recipeInstructions[0]["@type"], "HowToStep");
});
