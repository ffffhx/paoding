import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PORT = 41987;
const BASE = `http://127.0.0.1:${PORT}`;
let handleRequest, dataRoot, recipesDir, jobsDir, userFile;

const J = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-t-data-"));
  recipesDir = path.join(dataRoot, "recipes");
  jobsDir = path.join(dataRoot, "jobs");
  fs.mkdirSync(recipesDir, { recursive: true });
  fs.mkdirSync(jobsDir, { recursive: true });
  userFile = path.join(dataRoot, "ud.json");
  fs.writeFileSync(path.join(jobsDir, "restart-job.json"), JSON.stringify({
    id: "restart-job",
    type: "url",
    params: { url: "https://example.com/video" },
    status: "running",
    progress: { pct: 42, stage: "transcribe", message: "语音转文字…" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
  }, null, 2));
  // 自带 dummy 大模型配置，使集成测试不依赖本地 .env（被测端点都不真正调用 LLM）。
  Object.assign(process.env, {
    PAODING_PORT: String(PORT),
    PAODING_HOST: "127.0.0.1",
    PAODING_RECIPES_DIR: recipesDir,
    PAODING_USERDATA_FILE: userFile,
    PAODING_MAX_JOBS: "0",
    PAODING_API_TOKEN: "",
    PAODING_API_TOKENS: "",
    PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
    PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    PAODING_VISION_MODEL: "",
  });
  ({ handleRequest } = await import(`../app/server.mjs?test=${Date.now()}`));
});
after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

class MockReq extends EventEmitter {
  constructor(method, url, headers) {
    super();
    this.method = method;
    this.url = url;
    this.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    this.socket = { remoteAddress: "127.0.0.1" };
  }
  destroy() {
    this.destroyed = true;
  }
  pipe(dest) {
    this.on("data", (c) => dest.write(c));
    this.on("end", () => dest.end());
    this.on("error", (e) => dest.destroy(e));
    return dest;
  }
}

class MockRes {
  constructor() {
    this.statusCode = 200;
    this.headersSent = false;
    this._headers = new Map();
    this._chunks = [];
    this.done = new Promise((resolve) => { this._resolve = resolve; });
  }
  setHeader(k, v) {
    this._headers.set(k.toLowerCase(), String(v));
  }
  writeHead(code, headers = {}) {
    this.statusCode = code;
    for (const [k, v] of Object.entries(headers || {})) this.setHeader(k, v);
    this.headersSent = true;
  }
  write(chunk) {
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  end(chunk) {
    if (chunk != null) this.write(chunk);
    this.headersSent = true;
    this._resolve();
  }
  _body() {
    return Buffer.concat(this._chunks);
  }
  async text() {
    return this._body().toString("utf8");
  }
  async json() {
    return JSON.parse(await this.text());
  }
  async arrayBuffer() {
    const b = this._body();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  get headers() {
    return { get: (k) => this._headers.get(k.toLowerCase()) || null };
  }
  get status() {
    return this.statusCode;
  }
}

async function requestWith(handler, input, opts = {}, port = PORT) {
  const u = new URL(input, `http://127.0.0.1:${port}`);
  const headers = { host: `127.0.0.1:${port}`, ...(opts.headers || {}) };
  const req = new MockReq(opts.method || "GET", u.pathname + u.search, headers);
  const res = new MockRes();
  const handling = handler(req, res);
  process.nextTick(() => {
    if (opts.body != null) req.emit("data", Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body)));
    req.emit("end");
  });
  await Promise.all([Promise.resolve(handling), res.done]);
  return res;
}
async function request(input, opts = {}) {
  return requestWith(handleRequest, input, opts, PORT);
}
async function importServerWithEnv(env) {
  const keys = Object.keys(env);
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await import(`../app/server.mjs?test=${Date.now()}-${Math.random()}`);
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

test("空库 GET /api/recipes 返回 []", async () => {
  assert.deepEqual(await (await request("/api/recipes")).json(), []);
});

test("启动时 running 任务标记为 interrupted 并可查询", async () => {
  const jobs = await (await request("/api/jobs")).json();
  const j = jobs.find((x) => x.id === "restart-job");
  assert.ok(j);
  assert.equal(j.status, "interrupted");
  assert.match(j.error, /服务重启/);
});

test("GET /api/backups 返回备份文件列表", async () => {
  const backupsDir = path.join(dataRoot, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const name = "paoding-backup-2026-07-07T00:00:00.000Z.json";
  fs.writeFileSync(path.join(backupsDir, name), JSON.stringify({ ok: true }));
  const list = await (await request("/api/backups")).json();
  const item = list.find((x) => x.name === name);
  assert.ok(item);
  assert.equal(item.created_at, "2026-07-07T00:00:00.000Z");
  assert.ok(item.size > 0);
});

test("启动时自动补备份并包含菜谱和全部用户文件", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-backup-"));
  try {
    const port = 41994;
    const recipes2 = path.join(root, "recipes");
    const userFile2 = path.join(root, "ud.json");
    fs.mkdirSync(recipes2, { recursive: true });
    fs.writeFileSync(path.join(recipes2, "自动备份菜.json"), JSON.stringify({ title: "自动备份菜" }, null, 2));
    fs.writeFileSync(userFile2, JSON.stringify({ rev: 1, favRecipes: ["自动备份菜"] }, null, 2));
    fs.writeFileSync(path.join(root, "ud-alice.json"), JSON.stringify({ rev: 2, notes: { x: "y" } }, null, 2));

    await importServerWithEnv({
      PAODING_PORT: String(port),
      PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipes2,
      PAODING_USERDATA_FILE: userFile2,
      PAODING_API_TOKEN: "",
      PAODING_API_TOKENS: "",
      PAODING_BACKUP_INTERVAL_H: "24",
      PAODING_BACKUP_KEEP: "7",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    });

    const files = fs.readdirSync(path.join(root, "backups")).filter((f) => f.startsWith("paoding-backup-"));
    assert.equal(files.length, 1);
    const backup = JSON.parse(fs.readFileSync(path.join(root, "backups", files[0]), "utf8"));
    assert.equal(backup.recipes.find((r) => r.id === "自动备份菜")?.title, "自动备份菜");
    assert.deepEqual(backup.user_files.map((f) => f.name), ["ud-alice.json", "ud.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CORS 预检 OPTIONS → 204 + 头", async () => {
  const r = await request("/api/recipes", { method: "OPTIONS", headers: { Origin: "capacitor://localhost" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "capacitor://localhost");
});

test("CORS 允许同源，拒绝未配置的跨域来源", async () => {
  const same = await request("/api/recipes", { headers: { Origin: BASE } });
  assert.equal(same.status, 200);
  assert.equal(same.headers.get("access-control-allow-origin"), BASE);
  const cross = await request("/api/recipes", { headers: { Origin: "https://evil.example" } });
  assert.equal(cross.status, 200);
  assert.equal(cross.headers.get("access-control-allow-origin"), null);
});

test("userdata 空→PUT→回读", async () => {
  assert.deepEqual(await (await request("/api/userdata")).json(), { rev: 0 });
  const put = await request("/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: 0, favRecipes: ["x"] }) });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).rev, 1);
  assert.deepEqual(await (await request("/api/userdata")).json(), { rev: 1, favRecipes: ["x"] });
  const stale = await request("/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: 0, favRecipes: ["y"] }) });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.userdata.rev, 1);
  assert.deepEqual(conflict.userdata.favRecipes, ["x"]);
});

test("PAODING_API_TOKENS 双用户 userdata 与最近任务互不串扰", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-multi-"));
  try {
    const port = 41990;
    const userFile2 = path.join(root, "paoding-userdata.json");
    const recipes2 = path.join(root, "recipes");
    fs.mkdirSync(recipes2, { recursive: true });
    const { handleRequest: h } = await importServerWithEnv({
      PAODING_PORT: String(port),
      PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipes2,
      PAODING_USERDATA_FILE: userFile2,
      PAODING_MAX_JOBS: "0",
      PAODING_API_TOKEN: "",
      PAODING_API_TOKENS: "alice:tokA,bob:tokB",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    });
    const req = (token, input, opts = {}) => requestWith(h, input, {
      ...opts,
      headers: { ...(opts.headers || {}), "X-Paoding-Token": token },
    }, port);

    assert.equal((await requestWith(h, "/api/userdata", {}, port)).status, 401);
    assert.equal((await req("tokA", "/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: 0, favRecipes: ["alice"] }) })).status, 200);
    assert.equal((await req("tokB", "/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: 0, favRecipes: ["bob"] }) })).status, 200);
    assert.deepEqual((await (await req("tokA", "/api/userdata")).json()).favRecipes, ["alice"]);
    assert.deepEqual((await (await req("tokB", "/api/userdata")).json()).favRecipes, ["bob"]);
    assert.ok(fs.existsSync(path.join(root, "paoding-userdata-alice.json")));
    assert.ok(fs.existsSync(path.join(root, "paoding-userdata-bob.json")));

    const aliceJob = await (await req("tokA", "/api/parse-file", { method: "POST", headers: { "X-Filename": encodeURIComponent("a.mp4") }, body: Buffer.from("a") })).json();
    const bobJob = await (await req("tokB", "/api/parse-file", { method: "POST", headers: { "X-Filename": encodeURIComponent("b.mp4") }, body: Buffer.from("b") })).json();
    const aliceJobs = await (await req("tokA", "/api/jobs")).json();
    const bobJobs = await (await req("tokB", "/api/jobs")).json();
    assert.deepEqual(aliceJobs.map(j => j.id), [aliceJob.jobId]);
    assert.deepEqual(bobJobs.map(j => j.id), [bobJob.jobId]);
    assert.equal(aliceJobs[0].params._user, undefined);
    assert.equal(bobJobs[0].params._user, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PAODING_API_TOKEN 旧单 token 配置沿用原 userdata 文件", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-legacy-"));
  try {
    const port = 41991;
    const userFile2 = path.join(root, "ud.json");
    const recipes2 = path.join(root, "recipes");
    fs.mkdirSync(recipes2, { recursive: true });
    const { handleRequest: h } = await importServerWithEnv({
      PAODING_PORT: String(port),
      PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipes2,
      PAODING_USERDATA_FILE: userFile2,
      PAODING_API_TOKEN: "legacy-token",
      PAODING_API_TOKENS: "",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    });
    const req = (token, input, opts = {}) => requestWith(h, input, {
      ...opts,
      headers: { ...(opts.headers || {}), "X-Paoding-Token": token },
    }, port);
    assert.equal((await requestWith(h, "/api/userdata", {}, port)).status, 401);
    const put = await req("legacy-token", "/api/userdata", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: 0, favRecipes: ["x"] }) });
    assert.equal(put.status, 200);
    assert.deepEqual(await (await req("legacy-token", "/api/userdata")).json(), { rev: 1, favRecipes: ["x"] });
    assert.ok(fs.existsSync(userFile2));
    assert.ok(!fs.existsSync(path.join(root, "ud-default.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("限流维度包含用户", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-limit-user-"));
  try {
    const port = 41992;
    const recipes2 = path.join(root, "recipes");
    fs.mkdirSync(recipes2, { recursive: true });
    const { handleRequest: h } = await importServerWithEnv({
      PAODING_PORT: String(port),
      PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipes2,
      PAODING_USERDATA_FILE: path.join(root, "ud.json"),
      PAODING_API_TOKEN: "",
      PAODING_API_TOKENS: "alice:tokA,bob:tokB",
      PAODING_LLM_RATE_LIMIT_PER_MIN: "1",
      PAODING_LLM_RATE_LIMIT_WINDOW_MS: "60000",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    });
    const req = (token) => requestWith(h, "/api/techniques", { headers: { "X-Paoding-Token": token } }, port);
    assert.equal((await req("tokA")).status, 200);
    assert.equal((await req("tokA")).status, 429);
    assert.equal((await req("tokB")).status, 200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("import 写入→列表可见→分享页→删除", async () => {
  await request("/api/recipes"); // 预热列表缓存，导入后必须失效/刷新
  const imp = await (await request("/api/import", J({ recipes: [{ title: "测试菜X", steps: [{ index: 1, title: "a", action: "下锅翻炒" }], ingredients: [{ name: "盐", amount: "1勺" }] }] }))).json();
  assert.equal(imp.count, 1);
  const list = await (await request("/api/recipes")).json();
  assert.ok(list.some((r) => r.title === "测试菜X"));

  const share = await request("/r/" + encodeURIComponent("测试菜X"));
  assert.equal(share.status, 200);
  assert.ok((await share.text()).includes("测试菜X"));
  assert.equal((await request("/r/" + encodeURIComponent("不存在"))).status, 404);

  const del = await request("/api/recipes/" + encodeURIComponent("测试菜X"), { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.ok(!(await (await request("/api/recipes")).json()).some((r) => r.title === "测试菜X"));
});

test("菜谱路由拒绝嵌套路径或编码斜杠别名", async () => {
  const id = "别名防护菜";
  const fp = path.join(recipesDir, `${id}.json`);
  const dir = path.join(recipesDir, id);
  fs.writeFileSync(fp, JSON.stringify({
    title: id,
    steps: [{ index: 1, title: "切", action: "切菜", image: "step-1.jpg" }],
  }, null, 2));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "step-1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    const nestedDelete = await request(`/api/recipes/other/images/${encodeURIComponent(id)}`, { method: "DELETE" });
    assert.equal(nestedDelete.status, 404);
    assert.ok(fs.existsSync(fp), "嵌套 DELETE 不应折叠 basename 后删除真实菜谱");

    const encodedDelete = await request(`/api/recipes/${encodeURIComponent(`other/${id}`)}`, { method: "DELETE" });
    assert.equal(encodedDelete.status, 404);
    assert.ok(fs.existsSync(fp), "编码斜杠 DELETE 不应折叠 basename 后删除真实菜谱");

    const nestedPut = await request(`/api/recipes/other/images/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "被误改" }),
    });
    assert.equal(nestedPut.status, 404);
    assert.equal(JSON.parse(fs.readFileSync(fp, "utf8")).title, id);

    assert.equal((await request(`/r/${encodeURIComponent(`other/${id}`)}`)).status, 404);
    assert.equal((await request(`/api/recipes/${encodeURIComponent(`other/${id}`)}/images/step-1.jpg`)).status, 404);
  } finally {
    fs.rmSync(fp, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("分享页包含 JSON-LD、营养卡片和技法标注", async () => {
  const id = "分享互通菜";
  const fp = path.join(recipesDir, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify({
    title: id,
    cuisine: "家常菜",
    total_time_min: 12,
    servings: "2人份",
    ingredients: [{ name: "鸡蛋", amount: "2个" }],
    nutrition: {
      per_serving: { calories_kcal: 120, protein_g: 9, fat_g: 7, carbs_g: 2, sodium_mg: 300 },
      disclaimer: "AI 估算，仅供参考。",
    },
    steps: [{ index: 1, title: "快炒", action: "大火翻炒到断生。", why: { reason: "快速受热。" } }],
  }, null, 2));
  try {
    const share = await request("/r/" + encodeURIComponent(id));
    assert.equal(share.status, 200);
    const html = await share.text();
    assert.match(html, /type="application\/ld\+json"/);
    assert.match(html, /导出 JSON-LD/);
    assert.match(html, /复制到自己的庖丁/);
    assert.match(html, /每份营养/);
    assert.match(html, /<span class="tech">翻炒<\/span>/);

    const match = html.match(/<script type="application\/ld\+json" id="jsonld">([\s\S]*?)<\/script>/);
    assert.ok(match);
    const jsonld = JSON.parse(match[1]);
    assert.equal(jsonld["@type"], "Recipe");
    assert.equal(jsonld.name, id);
    assert.equal(jsonld.nutrition.calories, "120 kcal");
  } finally {
    fs.rmSync(fp, { force: true });
  }
});

test("import-recipe 导入 schema.org JSON-LD 且不生成 why", async () => {
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "外部导入菜",
    totalTime: "PT12M",
    recipeIngredient: ["豆腐 1块"],
    recipeInstructions: [{ "@type": "HowToStep", name: "煎", text: "豆腐煎到两面金黄。" }],
  };
  const imp = await request("/api/import-recipe", J({ jsonld: JSON.stringify(jsonld) }));
  assert.equal(imp.status, 200);
  const data = await imp.json();
  assert.equal(data.recipe.title, "外部导入菜");
  assert.equal(data.recipe.imported, true);
  assert.equal(data.recipe.total_time_min, 12);
  assert.equal(data.recipe.steps[0].why, undefined);
  assert.equal(data.recipe.steps[0].confidence, undefined);

  const saved = JSON.parse(fs.readFileSync(path.join(recipesDir, `${data.id}.json`), "utf8"));
  assert.equal(saved.imported, true);
  assert.equal(saved.steps[0].why, undefined);
  assert.ok((await (await request("/api/recipes")).json()).some((r) => r.id === data.id));
  assert.equal((await request("/api/recipes/" + encodeURIComponent(data.id), { method: "DELETE" })).status, 200);
});

test("recipes 列表缓存感知新增、mtime 修改和删除", async () => {
  const id = "缓存测试菜";
  const fp = path.join(recipesDir, `${id}.json`);
  fs.rmSync(fp, { force: true });

  await request("/api/recipes"); // 预热空/旧缓存
  fs.writeFileSync(fp, JSON.stringify({ title: id, created_at: "2026-07-01T00:00:00.000Z" }, null, 2));
  let list = await (await request("/api/recipes")).json();
  assert.equal(list.find((r) => r.id === id)?.title, id);

  fs.writeFileSync(fp, JSON.stringify({ title: "缓存测试菜-已更新", created_at: "2026-07-02T00:00:00.000Z" }, null, 2));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(fp, future, future);
  list = await (await request("/api/recipes")).json();
  assert.equal(list.find((r) => r.id === id)?.title, "缓存测试菜-已更新");

  fs.rmSync(fp, { force: true });
  list = await (await request("/api/recipes")).json();
  assert.equal(list.some((r) => r.id === id), false);
});

test("techniques 聚合全部菜谱步骤和 why", async () => {
  const id = "技法测试菜";
  fs.writeFileSync(path.join(recipesDir, `${id}.json`), JSON.stringify({
    title: id,
    steps: [
      { index: 1, title: "焯水", action: "排骨冷水下锅焯水。", why: { reason: "去腥并带走血沫。" } },
      { index: 2, title: "收尾", action: "大火收汁后勾芡。" },
    ],
  }));
  const data = await (await request("/api/techniques")).json();
  const blanch = data.find(x => x.technique === "焯水");
  assert.ok(blanch);
  assert.equal(blanch.count, 1);
  assert.equal(blanch.occurrences[0].recipeTitle, id);
  assert.equal(blanch.occurrences[0].why.reason, "去腥并带走血沫。");
  assert.ok(data.some(x => x.technique === "收汁"));
  assert.ok(data.some(x => x.technique === "勾芡"));
  fs.rmSync(path.join(recipesDir, `${id}.json`), { force: true });
});

test("technique summary 走 LLM、命中缓存并随技法样本集合变化失效", async () => {
  const cacheDir = path.join(dataRoot, "techniques-cache");
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const id1 = "技法归纳菜一";
  const id2 = "技法归纳菜二";
  const fp1 = path.join(recipesDir, `${id1}.json`);
  const fp2 = path.join(recipesDir, `${id2}.json`);
  fs.writeFileSync(fp1, JSON.stringify({
    title: id1,
    steps: [{ index: 1, title: "焯水", action: "排骨冷水下锅焯水。", why: { reason: "去腥并带走血沫。" } }],
  }, null, 2));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    assert.ok(String(input).endsWith("/chat/completions"));
    const body = JSON.parse(String(init.body || "{}"));
    assert.equal(body.response_format?.type, "json_object");
    calls++;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify({
        when: `用于去腥去血沫-${calls}`,
        keys: "浮沫明显后捞出冲净",
        pitfalls: "久煮会让肉变柴",
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const url = "/api/techniques/" + encodeURIComponent("焯水") + "/summary";
    let res = await request(url, { method: "POST" });
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.equal(data.cached, false);
    assert.equal(data.summary.when, "用于去腥去血沫-1");
    assert.equal(calls, 1);

    res = await request(url, { method: "POST" });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.cached, true);
    assert.equal(data.summary.when, "用于去腥去血沫-1");
    assert.equal(calls, 1);

    fs.writeFileSync(fp2, JSON.stringify({
      title: id2,
      steps: [{ index: 2, title: "飞水", action: "牛肉飞水后冲洗浮沫。", why: { cue: "水面有浮沫。" } }],
    }, null, 2));
    res = await request(url, { method: "POST" });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.cached, false);
    assert.equal(data.summary.when, "用于去腥去血沫-2");
    assert.equal(data.count, 2);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(fp1, { force: true });
    fs.rmSync(fp2, { force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("PAODING_OUTPUT_LANG=en 追加到服务端 AI prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-lang-"));
  const originalFetch = globalThis.fetch;
  const systems = [];
  try {
    const port = 41996;
    const recipes2 = path.join(root, "recipes");
    fs.mkdirSync(recipes2, { recursive: true });
    const id = "英文输出测试菜";
    fs.writeFileSync(path.join(recipes2, `${id}.json`), JSON.stringify({
      title: id,
      servings: "2人份",
      ingredients: [{ name: "排骨", amount: "500克" }],
      steps: [{ index: 1, title: "焯水", action: "排骨冷水下锅焯水。", why: { reason: "去腥。" } }],
    }, null, 2));
    globalThis.fetch = async (input, init = {}) => {
      assert.ok(String(input).endsWith("/chat/completions"));
      const body = JSON.parse(String(init.body || "{}"));
      const system = String(body.messages?.find((m) => m.role === "system")?.content || "");
      systems.push(system);
      let content = "ok";
      if (system.includes("营养师")) {
        content = JSON.stringify({
          nutrition: {
            per_serving: { calories_kcal: 100, protein_g: 10, fat_g: 3, carbs_g: 4, sodium_mg: 200 },
            disclaimer: "Estimated.",
            estimated: true,
          },
        });
      } else if (system.includes("技法教练")) {
        content = JSON.stringify({ when: "Use it to remove scum.", keys: "Watch for foam.", pitfalls: "Do not overboil." });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { handleRequest: h } = await importServerWithEnv({
      PAODING_PORT: String(port),
      PAODING_HOST: "127.0.0.1",
      PAODING_RECIPES_DIR: recipes2,
      PAODING_USERDATA_FILE: path.join(root, "ud.json"),
      PAODING_API_TOKEN: "",
      PAODING_API_TOKENS: "",
      PAODING_MAX_JOBS: "0",
      PAODING_VISION_MODEL: "",
      PAODING_LLM_BASE_URL: "http://paoding-llm-stub.test/v1",
      PAODING_LLM_API_KEY: "test",
      PAODING_OUTPUT_LANG: "en",
    });

    assert.equal((await requestWith(h, "/api/ask", J({ recipeId: id, stepIndex: 1, question: "why?" }), port)).status, 200);
    assert.equal((await requestWith(h, "/api/nutrition", J({ recipeId: id }), port)).status, 200);
    const techUrl = "/api/techniques/" + encodeURIComponent("焯水") + "/summary";
    assert.equal((await requestWith(h, techUrl, { method: "POST" }, port)).status, 200);

    assert.equal(systems.length, 3);
    assert.ok(systems.every((s) => s.includes("Output language: English")));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parse-url 非法链接 → 400", async () => {
  assert.equal((await request("/api/parse-url", J({ url: "notaurl" }))).status, 400);
});

test("parse-url 私网链接 → 400", async () => {
  const r = await request("/api/parse-url", J({ url: "http://127.0.0.1:4177/video" }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /拒绝访问/);
});

test("parse-text 太短 → 400", async () => {
  assert.equal((await request("/api/parse-text", J({ text: "短" }))).status, 400);
});

test("parse-images 未配置视觉模型 → 400", async () => {
  const r = await request("/api/parse-images", J({
    images: [{ name: "recipe.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,/9j/2Q==" }],
  }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /需配置视觉模型/);
});

test("parse-file 中等 body 上传返回 jobId", async () => {
  const body = Buffer.alloc(256 * 1024, 7);
  const r = await request("/api/parse-file", {
    method: "POST",
    headers: { "X-Filename": encodeURIComponent("upload.mp4"), "Content-Type": "application/octet-stream" },
    body,
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.match(data.jobId, /^[0-9a-f-]{36}$/);
  const jobs = await (await request("/api/jobs")).json();
  const job = jobs.find((x) => x.id === data.jobId);
  assert.equal(job.status, "queued");
  assert.equal(job.params.filename, "upload.mp4");
});

test("AI ask 菜谱不存在 → 404", async () => {
  const r = await request("/api/ask", J({ recipeId: "nope", stepIndex: 1, question: "为什么？" }));
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: "菜谱不存在" });
});

test("nutrition 缓存返回结构化结果，编辑食材后失效", async () => {
  const id = "营养测试菜";
  fs.writeFileSync(path.join(recipesDir, `${id}.json`), JSON.stringify({
    title: id,
    servings: "2人份",
    ingredients: [{ name: "鸡蛋", amount: "2个" }],
    nutrition: { per_serving: { calories_kcal: 120, protein_g: 9, fat_g: 7, carbs_g: 2, sodium_mg: 300 }, disclaimer: "AI 估算，仅供参考。", estimated: true },
  }));
  const cached = await (await request("/api/nutrition", J({ recipeId: id }))).json();
  assert.equal(cached.cached, true);
  assert.equal(cached.nutrition.per_serving.calories_kcal, 120);

  const put = await request(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredients: [{ name: "鸡蛋", amount: "3个" }] }),
  });
  assert.equal(put.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(recipesDir, `${id}.json`), "utf8"));
  assert.equal(saved.nutrition, undefined);
  fs.rmSync(path.join(recipesDir, `${id}.json`), { force: true });
});

test("静态首页含庖丁", async () => {
  const r = await request("/");
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes("庖丁"));
});

test("兼容 /paoding 子路径首页和 API", async () => {
  const home = await request("/paoding/");
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes("庖丁"));

  const api = await request("/paoding/api/recipes");
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), []);

  const sw = await request("/paoding/sw.js");
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /Service Worker/);
});

test("recipes/ 目录禁止直接静态访问", async () => {
  assert.equal((await request("/recipes/anything.json")).status, 403);
});

test("非回环监听未配置 token 时拒绝启动", async () => {
  const bad = spawn("node", [path.join(ROOT, "app/server.mjs")], {
    env: {
      ...process.env,
      PAODING_PORT: "41988",
      PAODING_HOST: "0.0.0.0",
      PAODING_API_TOKEN: "",
      PAODING_ALLOW_INSECURE: "",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  bad.stderr.on("data", (b) => { err += b; });
  const [code] = await once(bad, "exit");
  assert.notEqual(code, 0);
  assert.match(err, /PAODING_API_TOKEN/);
  assert.match(err, /PAODING_ALLOW_INSECURE=1/);
});

test("PAODING_API_TOKENS 拒绝非法用户名", async () => {
  const bad = spawn("node", [path.join(ROOT, "app/server.mjs")], {
    env: {
      ...process.env,
      PAODING_PORT: "41993",
      PAODING_HOST: "127.0.0.1",
      PAODING_API_TOKEN: "",
      PAODING_API_TOKENS: "bad/name:tok",
      PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
      PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  bad.stderr.on("data", (b) => { err += b; });
  const [code] = await once(bad, "exit");
  assert.notEqual(code, 0);
  assert.match(err, /PAODING_API_TOKENS/);
  assert.match(err, /非法用户/);
});

/* ===== 菜谱截图（步骤状态图/食材图）====== */
test("菜谱图片路由：读图/404/防穿越/删除连图一起删", async () => {
  // 造一道带图的菜：json + 同名目录下的 jpg
  const id = "图测菜";
  fs.writeFileSync(path.join(recipesDir, `${id}.json`), JSON.stringify({
    title: id, created_at: "2026-01-01",
    ingredients: [{ name: "葱", amount: "1根", image: "ing-1.jpg" }],
    steps: [{ index: 1, title: "切", action: "切葱", image: "step-1.jpg" }],
  }));
  const dir = path.join(recipesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);
  fs.writeFileSync(path.join(dir, "step-1.jpg"), fakeJpg);

  // 读图 200 + jpeg 头
  const ok = await request(`/api/recipes/${encodeURIComponent(id)}/images/step-1.jpg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal((await ok.arrayBuffer()).byteLength, fakeJpg.length);

  // 不存在的图 404；带路径穿越/非法文件名 404
  assert.equal((await request(`/api/recipes/${encodeURIComponent(id)}/images/none.jpg`)).status, 404);
  assert.equal((await request(`/api/recipes/${encodeURIComponent(id)}/images/${encodeURIComponent("../" + id + ".json")}`)).status, 404);
  assert.equal((await request(`/api/recipes/${encodeURIComponent(id)}/images/x.png`)).status, 404);

  // 子路径部署下同样可用
  assert.equal((await request(`/paoding/api/recipes/${encodeURIComponent(id)}/images/step-1.jpg`)).status, 200);

  // 删除菜谱 → 图片目录一并清掉
  assert.equal((await request(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" })).status, 200);
  assert.ok(!fs.existsSync(dir), "删除菜谱应连图片目录一起删");
});
