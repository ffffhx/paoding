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
    PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL || "http://localhost:11434/v1",
    PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY || "test",
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

async function request(input, opts = {}) {
  const u = new URL(input, BASE);
  const headers = { host: `127.0.0.1:${PORT}`, ...(opts.headers || {}) };
  const req = new MockReq(opts.method || "GET", u.pathname + u.search, headers);
  const res = new MockRes();
  const handling = handleRequest(req, res);
  process.nextTick(() => {
    if (opts.body != null) req.emit("data", Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body)));
    req.emit("end");
  });
  await Promise.all([Promise.resolve(handling), res.done]);
  return res;
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

test("import 写入→列表可见→分享页→删除", async () => {
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
