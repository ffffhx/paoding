import { test } from "node:test";
import assert from "node:assert/strict";
import { TECHNIQUE_TERMS, extractTechniques } from "../src/techniques.mjs";
import {
  isTechniqueSummaryCacheFresh,
  normalizeTechniqueSummary,
  techniqueCacheFileName,
  techniqueOccurrenceSignature,
} from "../src/techniqueSummary.mjs";

test("技法词表保持 30-50 个常见中餐技法", () => {
  assert.ok(TECHNIQUE_TERMS.length >= 30);
  assert.ok(TECHNIQUE_TERMS.length <= 50);
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "焯水" && t.aliases.includes("飞水")));
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "上浆"));
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "拍松" && t.aliases.includes("压扁")));
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "擀制" && t.aliases.includes("擀面皮")));
  assert.ok(TECHNIQUE_TERMS.some(t => t.technique === "卤制" && t.aliases.includes("卤汁")));
});

test("extractTechniques 扫描步骤文本和 why 文本，并按步骤去重", () => {
  const hits = extractTechniques({
    id: "r1",
    steps: [
      { index: 1, title: "焯水去腥", action: "牛肉冷水下锅飞水，撇去浮沫。", why: { reason: "焯水能减少血沫。" } },
      { index: 2, title: "炒制", action: "葱姜蒜爆香后大火快炒。", why: { cue: "香味出来即可。" } },
      { index: 3, title: "收尾", action: "转大火收汁，最后勾芡。" },
      { index: 4, title: "凉拌", action: "黄瓜压扁切块后加入调料抓匀。" },
      { index: 5, title: "擀皮", action: "把面团擀成薄片，再切成面剂。" },
      { index: 6, title: "蛋汤", action: "番茄炒出汤汁后淋入蛋液形成蛋花。" },
      { index: 7, title: "卤鸡腿", action: "鸡腿卤制后泡在卤汁中浸泡入味。" },
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
    { technique: "切配", recipeId: "r1", stepIndex: 4 },
    { technique: "拍松", recipeId: "r1", stepIndex: 4 },
    { technique: "拌匀", recipeId: "r1", stepIndex: 4 },
    { technique: "切配", recipeId: "r1", stepIndex: 5 },
    { technique: "擀制", recipeId: "r1", stepIndex: 5 },
    { technique: "炒出汁", recipeId: "r1", stepIndex: 6 },
    { technique: "淋蛋成花", recipeId: "r1", stepIndex: 6 },
    { technique: "卤制", recipeId: "r1", stepIndex: 7 },
    { technique: "浸泡入味", recipeId: "r1", stepIndex: 7 },
  ]);
});

test("技法归纳缓存签名随出现集合变化失效", () => {
  const sig1 = techniqueOccurrenceSignature([
    { recipeId: "红烧肉", stepIndex: 2 },
    { recipeId: "番茄炒蛋", stepIndex: 1 },
  ]);
  const sig1b = techniqueOccurrenceSignature([
    { recipeId: "番茄炒蛋", stepIndex: 1 },
    { recipeId: "红烧肉", stepIndex: 2 },
  ]);
  const sig2 = techniqueOccurrenceSignature([
    { recipeId: "红烧肉", stepIndex: 2 },
    { recipeId: "番茄炒蛋", stepIndex: 1 },
    { recipeId: "青椒肉丝", stepIndex: 3 },
  ]);
  assert.equal(sig1, sig1b);
  assert.notEqual(sig1, sig2);
  assert.equal(isTechniqueSummaryCacheFresh({ signature: sig1, summary: { when: "x" } }, sig1), true);
  assert.equal(isTechniqueSummaryCacheFresh({ signature: sig1, summary: { when: "x" } }, sig2), false);
  assert.match(techniqueCacheFileName("焯水/飞水"), /^[A-Za-z0-9_-]+\.json$/);
});

test("normalizeTechniqueSummary 兼容中英文归纳字段", () => {
  assert.deepEqual(normalizeTechniqueSummary({
    "什么时候用": "去血沫时",
    "关键判断": "水面有浮沫",
    "常见翻车点": "久煮变柴",
  }), {
    when: "去血沫时",
    keys: "水面有浮沫",
    pitfalls: "久煮变柴",
  });
});
