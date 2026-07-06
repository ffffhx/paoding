import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PORT = 41987;
const BASE = `http://127.0.0.1:${PORT}`;
let child, recipesDir, userFile;

const J = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  recipesDir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-t-recipes-"));
  userFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paoding-t-ud-")), "ud.json");
  child = spawn("node", [path.join(ROOT, "app/server.mjs")], {
    // 自带 dummy 大模型配置，使集成测试不依赖本地 .env（被测端点都不真正调用 LLM）
    env: {
      ...process.env, PAODING_PORT: String(PORT), PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipesDir, PAODING_USERDATA_FILE: userFile,
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + "/api/recipes"); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("测试服务器未能启动");
});
after(() => child && child.kill());

test("空库 GET /api/recipes 返回 []", async () => {
  assert.deepEqual(await (await fetch(BASE + "/api/recipes")).json(), []);
});

test("CORS 预检 OPTIONS → 204 + 头", async () => {
  const r = await fetch(BASE + "/api/recipes", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("userdata 空→PUT→回读", async () => {
  assert.deepEqual(await (await fetch(BASE + "/api/userdata")).json(), {});
  const put = await fetch(BASE + "/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favRecipes: ["x"] }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await fetch(BASE + "/api/userdata")).json(), { favRecipes: ["x"] });
});

test("import 写入→列表可见→分享页→删除", async () => {
  const imp = await (await fetch(BASE + "/api/import", J({ recipes: [{ title: "测试菜X", steps: [{ index: 1, title: "a", action: "下锅翻炒" }], ingredients: [{ name: "盐", amount: "1勺" }] }] }))).json();
  assert.equal(imp.count, 1);
  const list = await (await fetch(BASE + "/api/recipes")).json();
  assert.ok(list.some((r) => r.title === "测试菜X"));

  const share = await fetch(BASE + "/r/" + encodeURIComponent("测试菜X"));
  assert.equal(share.status, 200);
  assert.ok((await share.text()).includes("测试菜X"));
  assert.equal((await fetch(BASE + "/r/" + encodeURIComponent("不存在"))).status, 404);

  const del = await fetch(BASE + "/api/recipes/" + encodeURIComponent("测试菜X"), { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.ok(!(await (await fetch(BASE + "/api/recipes")).json()).some((r) => r.title === "测试菜X"));
});

test("parse-url 非法链接 → 400", async () => {
  assert.equal((await fetch(BASE + "/api/parse-url", J({ url: "notaurl" }))).status, 400);
});

test("parse-text 太短 → 400", async () => {
  assert.equal((await fetch(BASE + "/api/parse-text", J({ text: "短" }))).status, 400);
});

test("静态首页含庖丁", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes("庖丁"));
});

test("兼容 /paoding 子路径首页和 API", async () => {
  const home = await fetch(BASE + "/paoding/");
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes("庖丁"));

  const api = await fetch(BASE + "/paoding/api/recipes");
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), []);

  const sw = await fetch(BASE + "/paoding/sw.js");
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /Service Worker/);
});

test("recipes/ 目录禁止直接静态访问", async () => {
  assert.equal((await fetch(BASE + "/recipes/anything.json")).status, 403);
});
