import { test } from "node:test";
import assert from "node:assert/strict";
import { TECHNIQUE_TERMS, extractTechniques } from "../src/techniques.mjs";

test("技法词表保持 30-50 个常见中餐技法", () => {
  assert.ok(TECHNIQUE_TERMS.length >= 30);
  assert.ok(TECHNIQUE_TERMS.length <= 50);
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "焯水" && t.aliases.includes("飞水")));
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "上浆"));
});

test("extractTechniques 扫描步骤文本和 why 文本，并按步骤去重", () => {
  const hits = extractTechniques({
    id: "r1",
    steps: [
      { index: 1, title: "焯水去腥", action: "牛肉冷水下锅飞水，撇去浮沫。", why: { reason: "焯水能减少血沫。" } },
      { index: 2, title: "炒制", action: "葱姜蒜爆香后大火快炒。", why: { cue: "香味出来即可。" } },
      { index: 3, title: "收尾", action: "转大火收汁，最后勾芡。" },
    ],
  });
  assert.deepEqual(hits, [
    { technique: "焯水", recipeId: "r1", stepIndex: 1 },
    { technique: "去腥", recipeId: "r1", stepIndex: 1 },
    { technique: "撇沫", recipeId: "r1", stepIndex: 1 },
    { technique: "炝锅", recipeId: "r1", stepIndex: 2 },
    { technique: "爆香", recipeId: "r1", stepIndex: 2 },
    { technique: "翻炒", recipeId: "r1", stepIndex: 2 },
    { technique: "大火快炒", recipeId: "r1", stepIndex: 2 },
    { technique: "收汁", recipeId: "r1", stepIndex: 3 },
    { technique: "勾芡", recipeId: "r1", stepIndex: 3 },
  ]);
});
