import { performance } from "node:perf_hooks";

const STAGE_LABELS = {
  acquire: "下载/抽音",
  transcribe: "ASR",
  vision: "视觉读屏",
  structure: "结构化",
  explain: "讲解",
  step_images: "步骤图",
  ingredient_images: "食材图",
  step_clips: "步骤视频",
  total: "总计",
};

const STAGE_ORDER = [
  "acquire",
  "transcribe",
  "vision",
  "structure",
  "explain",
  "step_images",
  "ingredient_images",
  "step_clips",
  "total",
];

export function roundTimingSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10) / 10;
}

export function addStageTiming(timings, stage, seconds) {
  if (!timings || !stage) return timings;
  const prev = Number(timings[stage]) || 0;
  timings[stage] = roundTimingSeconds(prev + Number(seconds || 0));
  return timings;
}

export function createStageTimer({ now = () => performance.now() } = {}) {
  const timings = {};
  const startedAt = now();

  async function time(stage, fn) {
    const t0 = now();
    try {
      return await fn();
    } finally {
      addStageTiming(timings, stage, (now() - t0) / 1000);
    }
  }

  function snapshot({ includeTotal = false } = {}) {
    const out = { ...timings };
    if (includeTotal) out.total = roundTimingSeconds((now() - startedAt) / 1000);
    return out;
  }

  return { timings, time, snapshot };
}

export function timingRows(timings = {}) {
  const keys = [
    ...STAGE_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(timings, key)),
    ...Object.keys(timings).filter((key) => !STAGE_ORDER.includes(key)).sort(),
  ];
  return keys.map((key) => ({
    key,
    label: STAGE_LABELS[key] || key,
    seconds: roundTimingSeconds(timings[key]),
  }));
}

export function formatTimingTable(timings = {}) {
  const rows = timingRows(timings).filter((row) => row.seconds > 0 || row.key === "total");
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.label.length));
  const total = Number(timings.total) || rows.reduce((sum, row) => row.key === "total" ? sum : sum + row.seconds, 0);
  const lines = ["耗时分解："];
  for (const row of rows) {
    const pct = total > 0 && row.key !== "total" ? ` (${Math.round((row.seconds / total) * 100)}%)` : "";
    lines.push(`  · ${row.label.padEnd(width, " ")}  ${row.seconds.toFixed(1)}s${pct}`);
  }
  return lines.join("\n");
}
