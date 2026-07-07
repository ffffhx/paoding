import { test } from "node:test";
import assert from "node:assert/strict";
import { addStageTiming, createStageTimer, formatTimingTable, roundTimingSeconds, timingRows } from "../src/timings.mjs";

test("roundTimingSeconds 规整到 0.1 秒并拒绝异常值", () => {
  assert.equal(roundTimingSeconds(1.24), 1.2);
  assert.equal(roundTimingSeconds(1.25), 1.3);
  assert.equal(roundTimingSeconds(-1), 0);
  assert.equal(roundTimingSeconds(Number.NaN), 0);
});

test("addStageTiming 按阶段累计耗时", () => {
  const timings = {};
  addStageTiming(timings, "vision", 1.21);
  addStageTiming(timings, "vision", 2.34);
  addStageTiming(timings, "explain", 0.04);
  assert.deepEqual(timings, { vision: 3.5, explain: 0 });
});

test("createStageTimer 记录异步阶段并生成 total 快照", async () => {
  let t = 1000;
  const timer = createStageTimer({ now: () => t });
  await timer.time("acquire", async () => { t += 1234; });
  await timer.time("structure", async () => { t += 2500; });
  t += 266;
  assert.deepEqual(timer.snapshot({ includeTotal: true }), {
    acquire: 1.2,
    structure: 2.5,
    total: 4,
  });
});

test("timingRows 和 formatTimingTable 按固定阶段顺序输出", () => {
  const timings = { explain: 7.2, acquire: 1.1, custom: 2, total: 10.3 };
  assert.deepEqual(timingRows(timings).map((row) => row.key), ["acquire", "explain", "total", "custom"]);
  const text = formatTimingTable(timings);
  assert.match(text, /耗时分解/);
  assert.match(text, /下载\/抽音\s+1\.1s/);
  assert.match(text, /讲解\s+7\.2s/);
  assert.match(text, /总计\s+10\.3s/);
  assert.match(text, /custom\s+2\.0s/);
});
