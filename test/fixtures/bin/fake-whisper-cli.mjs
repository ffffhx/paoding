#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

if (process.env.PAODING_FAKE_WHISPER_FAIL === "1") {
  console.error("fake whisper forced failure");
  process.exit(25);
}

const args = process.argv.slice(2);
if (!args.length) process.exit(0);
const outIndex = args.indexOf("-of");
if (outIndex === -1 || !args[outIndex + 1]) {
  console.error("fake whisper missing -of");
  process.exit(2);
}

const outBase = args[outIndex + 1];
const jsonPath = `${outBase}.json`;
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });

const transcription = process.env.PAODING_FAKE_WHISPER_EMPTY === "1"
  ? []
  : [
      { offsets: { from: 0, to: 10000 }, text: "准备鸡蛋和番茄。" },
      { offsets: { from: 10000, to: 30000 }, text: "鸡蛋打散下锅炒到凝固后盛出。" },
      { offsets: { from: 30000, to: 50000 }, text: "番茄炒出汁，倒回鸡蛋，加盐调味。" },
    ];

fs.writeFileSync(jsonPath, JSON.stringify({ transcription }, null, 2));
console.error("progress = 100%");
