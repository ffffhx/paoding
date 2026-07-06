#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

if (process.env.PAODING_FAKE_YTDLP_FAIL === "1") {
  console.error("fake yt-dlp forced failure");
  process.exit(23);
}

const args = process.argv.slice(2);
if (!args.length) process.exit(0);

if (args.includes("-j")) {
  process.stdout.write(JSON.stringify({
    title: "集成测试番茄炒蛋",
    description: "鸡蛋和番茄的测试视频说明",
    duration: 52,
  }));
  process.exit(0);
}

const outIndex = args.indexOf("-o");
if (outIndex === -1 || !args[outIndex + 1]) {
  console.error("fake yt-dlp missing -o");
  process.exit(2);
}

let out = args[outIndex + 1];
const ext = args.includes("--merge-output-format") ? "mp4" : "mp3";
out = out.replace("%(ext)s", ext);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `fake ${ext} media\n`);
console.error("[download] 100.0% of 1.00MiB");
