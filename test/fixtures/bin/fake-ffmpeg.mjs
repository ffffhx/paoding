#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

if (process.env.PAODING_FAKE_FFMPEG_FAIL === "1") {
  console.error("fake ffmpeg forced failure");
  process.exit(24);
}

const args = process.argv.slice(2);
if (!args.length) process.exit(0);
const output = args[args.length - 1];
if (!output || output.startsWith("-")) {
  console.error("fake ffmpeg missing output");
  process.exit(2);
}

function write(file, body = "fake media\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

if (output.includes("%03d")) {
  write(output.replace("%03d", "000"), "fake mp3 chunk\n");
} else if (output.includes("%04d")) {
  write(output.replace("%04d", "0001"), "fake jpg frame\n");
} else {
  write(output, output.endsWith(".jpg") ? "fake jpg frame\n" : "fake mp3 audio\n");
}
