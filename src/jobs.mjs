import fs from "node:fs";
import path from "node:path";

export const JOB_INTERRUPTED_MESSAGE = "服务重启，任务中断，请重新发起";
export const TERMINAL_JOB_STATUSES = new Set(["done", "error", "interrupted"]);

export function createJobQueue(limit = 10) {
  const max = Math.max(0, Number(limit) || 0);
  const items = [];
  return {
    get limit() { return max; },
    get length() { return items.length; },
    isFull() { return items.length >= max; },
    enqueue(item) {
      if (!item || !item.id) throw new Error("队列任务缺少 id");
      if (items.length >= max) return { ok: false, position: 0 };
      items.push({ ...item, ready: item.ready !== false });
      return { ok: true, position: items.length };
    },
    dequeueReady() {
      if (!items.length || items[0].ready === false) return null;
      return items.shift();
    },
    markReady(id, patch = {}) {
      const item = items.find((x) => x.id === id);
      if (!item) return false;
      Object.assign(item, patch, { ready: true });
      return true;
    },
    remove(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i === -1) return null;
      return items.splice(i, 1)[0];
    },
    position(id) {
      const i = items.findIndex((x) => x.id === id);
      return i === -1 ? 0 : i + 1;
    },
    snapshot() {
      return items.map((x, i) => ({ id: x.id, ready: x.ready !== false, position: i + 1 }));
    },
  };
}

export function createJobRecord({ id, type, params = {}, status = "queued", progress, now = new Date().toISOString() }) {
  return {
    id,
    type,
    params,
    status,
    progress: progress || { pct: 0, stage: status, message: status === "queued" ? "排队中，第 1 位" : "准备中…" },
    result_recipe_id: null,
    error: null,
    created_at: now,
    updated_at: now,
    queued_at: status === "queued" ? now : null,
    started_at: status === "running" ? now : null,
    finished_at: null,
  };
}

export function publicJob(job) {
  if (!job || typeof job !== "object") return null;
  return {
    id: job.id,
    type: job.type || "",
    params: job.params || {},
    status: job.status || "unknown",
    progress: job.progress || null,
    result_recipe_id: job.result_recipe_id || null,
    error: job.error || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
    queued_at: job.queued_at || null,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
  };
}

export class FileJobStore {
  constructor(dir, { keep = 50, now = () => new Date().toISOString() } = {}) {
    this.dir = dir;
    this.keep = keep;
    this.now = now;
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const jobs = this.readAll();
    for (const job of jobs) {
      if (job.status === "running" || job.status === "queued" || job.status === "receiving") {
        const t = this.now();
        job.status = "interrupted";
        job.error = JOB_INTERRUPTED_MESSAGE;
        job.progress = { pct: job.progress?.pct || 0, stage: "interrupted", message: JOB_INTERRUPTED_MESSAGE };
        job.updated_at = t;
        job.finished_at = t;
        this.write(job, { cleanup: false });
      }
    }
    this.cleanup();
    return this.readAll();
  }

  readAll() {
    fs.mkdirSync(this.dir, { recursive: true });
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.read(path.basename(f, ".json")))
      .filter(Boolean);
  }

  read(id) {
    const fp = this.pathFor(id);
    if (!fs.existsSync(fp)) return null;
    try {
      const job = JSON.parse(fs.readFileSync(fp, "utf8"));
      return publicJob(job);
    } catch {
      return null;
    }
  }

  write(job, { cleanup = true } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    const clean = publicJob({ ...job, updated_at: job.updated_at || this.now() });
    const fp = this.pathFor(clean.id);
    const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
    fs.renameSync(tmp, fp);
    if (cleanup && TERMINAL_JOB_STATUSES.has(clean.status)) this.cleanup();
    return clean;
  }

  remove(id) {
    fs.rmSync(this.pathFor(id), { force: true });
  }

  recent(limit = 20) {
    return this.readAll()
      .sort((a, b) => jobTime(b) - jobTime(a))
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  cleanup() {
    const keep = Math.max(0, Number(this.keep) || 0);
    const terminal = this.readAll()
      .filter((j) => TERMINAL_JOB_STATUSES.has(j.status))
      .sort((a, b) => jobTime(b) - jobTime(a));
    for (const job of terminal.slice(keep)) this.remove(job.id);
  }

  pathFor(id) {
    return path.join(this.dir, `${path.basename(String(id || ""))}.json`);
  }
}

function jobTime(job) {
  return Date.parse(job.updated_at || job.finished_at || job.started_at || job.queued_at || job.created_at || "") || 0;
}
