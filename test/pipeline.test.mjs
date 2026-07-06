import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processImages, processText, processVideo } from "../src/pipeline.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(TEST_DIR, "fixtures", "bin");
const FAKE_YTDLP = path.join(BIN_DIR, "fake-yt-dlp.mjs");
const FAKE_FFMPEG = path.join(BIN_DIR, "fake-ffmpeg.mjs");
const FAKE_WHISPER = path.join(BIN_DIR, "fake-whisper-cli.mjs");
const SYSTEM_TMP = os.tmpdir();

function stubRecipe() {
  return {
    title: "集成测试番茄炒蛋",
    servings: "2人份",
    total_time_min: 10,
    difficulty: "easy",
    cuisine: "家常菜",
    tags: ["快手", "下饭", "家常菜"],
    ingredients: [
      { name: "鸡蛋", amount: "3个", qty: 3, unit: "个", note: "" },
      { name: "番茄", amount: "2个", qty: 2, unit: "个", note: "" },
    ],
    steps: [
      {
        index: 1,
        title: "准备食材",
        action: "鸡蛋打散，番茄切块。",
        params: { heat: "", temp: "", time: "", cue: "蛋液均匀、番茄成块" },
        source_time: [0, 10],
      },
      {
        index: 2,
        title: "炒鸡蛋",
        action: "热锅下油，把鸡蛋炒到刚凝固后盛出。",
        params: { heat: "中火", temp: "", time: "约30秒", cue: "蛋液刚凝固" },
        source_time: [10, 30],
      },
      {
        index: 3,
        title: "合炒调味",
        action: "番茄炒出汁后倒回鸡蛋，加盐调味。",
        params: { heat: "中火", temp: "", time: "约1分钟", cue: "番茄出汁" },
        source_time: [30, 50],
      },
    ],
  };
}

function stubExplanations() {
  return {
    explanations: [
      {
        index: 1,
        reason: "先处理食材能让下锅节奏稳定。",
        if_not: "临时切配容易让锅中食材过火。",
        cue: "食材形状均匀。",
        risk_level: "low",
        confidence: "high",
      },
      {
        index: 2,
        reason: "鸡蛋先炒定型，后面回锅不容易碎。",
        if_not: "一直混炒会让鸡蛋变老。",
        cue: "蛋块刚凝固仍然柔软。",
        risk_level: "medium",
        confidence: "high",
      },
      {
        index: 3,
        reason: "番茄出汁后再合炒，鸡蛋能挂上酸甜汁水。",
        if_not: "太早合炒会稀释香气。",
        cue: "锅底有红色汁水。",
        risk_level: "low",
        confidence: "high",
      },
    ],
  };
}

async function startLlmStub({ malformedFirst = false, imageText = "" } = {}) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (init.method !== "POST" || !url.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }

    const body = JSON.parse(String(init.body || "{}"));
    requests.push(body);
    calls++;

    const system = String(body.messages?.find((m) => m.role === "system")?.content || "");
    let content;
    if (malformedFirst && calls === 1) {
      content = "这不是 JSON";
    } else if (system.includes("菜谱图片转录助手")) {
      content = imageText || "标题：集成测试番茄炒蛋\n食材：鸡蛋3个，番茄2个\n步骤：1. 打散鸡蛋。2. 炒番茄出汁。3. 合炒调味。";
    } else if (system.includes("专业中餐厨师兼菜谱编辑")) {
      content = JSON.stringify(stubRecipe());
    } else if (system.includes("食品科学")) {
      content = JSON.stringify(stubExplanations());
    } else {
      content = JSON.stringify({});
    }

    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    get calls() { return calls; },
    requests,
    url: "http://paoding-llm-stub.test/v1",
    close: async () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function addVision(config, baseUrl) {
  config.vision = {
    baseUrl,
    apiKey: "test-key",
    model: "stub-vision",
    maxFrames: 4,
  };
  return config;
}

function createConfig(root, llmBaseUrl) {
  const whisperModel = path.join(root, "fake-whisper-model.bin");
  fs.writeFileSync(whisperModel, "fake model\n");
  return {
    llm: { baseUrl: llmBaseUrl, apiKey: "test-key", model: "stub-chat" },
    asr: {
      provider: "local",
      whisperBin: FAKE_WHISPER,
      whisperModel,
      ffmpegBin: FAKE_FFMPEG,
      lang: "zh",
    },
    ytdlp: {
      bin: FAKE_YTDLP,
      ffmpegBin: FAKE_FFMPEG,
      userAgent: "paoding-test",
    },
    outDir: path.join(root, "out"),
    depth: "balanced",
    vision: null,
    images: null,
  };
}

function paodingTmpEntries(root) {
  return fs.existsSync(root)
    ? fs.readdirSync(root).filter((name) => name.startsWith("paoding-")).sort()
    : [];
}

function assertNoNewPaodingTmp(root, before) {
  const leaked = paodingTmpEntries(root).filter((name) => !before.has(name));
  assert.deepEqual(leaked, []);
}

async function withIsolatedTmp(fn) {
  const root = fs.mkdtempSync(path.join(SYSTEM_TMP, "pipeline-test-"));
  const old = {
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
  try {
    return await fn(root);
  } finally {
    if (old.TMPDIR === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = old.TMPDIR;
    if (old.TMP === undefined) delete process.env.TMP;
    else process.env.TMP = old.TMP;
    if (old.TEMP === undefined) delete process.env.TEMP;
    else process.env.TEMP = old.TEMP;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function withEnv(values, fn) {
  const old = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("processVideo 使用可注入二进制跑通本地视频管线并清理临时目录", async () => {
  const llm = await startLlmStub();
  try {
    await withIsolatedTmp(async (root) => {
      const before = new Set(paodingTmpEntries(root));
      const config = createConfig(root, llm.url);
      const input = path.join(root, "input.mp4");
      fs.writeFileSync(input, "fake video\n");

      const { recipe, files } = await processVideo(input, config, { keepTranscript: true });

      assert.equal(recipe.title, "集成测试番茄炒蛋");
      assert.equal(recipe.ingredients.length, 2);
      assert.equal(recipe.steps.length, 3);
      assert.deepEqual(recipe.steps.map((s) => s.source_time), [[0, 10], [10, 30], [30, 50]]);
      assert.ok(recipe.steps.every((s) => s.why?.reason));
      assert.ok(recipe._transcript.includes("[00:10]"));
      assert.ok(fs.existsSync(files.json));
      assert.ok(fs.existsSync(files.md));
      assertNoNewPaodingTmp(root, before);
    });
  } finally {
    await llm.close();
  }
});

test("yt-dlp 失败时视频管线报错，文字管线可作为降级路径跑通", async () => {
  const llm = await startLlmStub();
  try {
    await withIsolatedTmp(async (root) => {
      const before = new Set(paodingTmpEntries(root));
      const config = createConfig(root, llm.url);
      await withEnv({ PAODING_FAKE_YTDLP_FAIL: "1" }, async () => {
        await assert.rejects(
          () => processVideo("https://93.184.216.34/watch?v=1", config),
          /yt-dlp.*退出码 23/,
        );
      });
      assertNoNewPaodingTmp(root, before);

      const { recipe, files } = await processText("番茄炒蛋\n鸡蛋3个，番茄2个。先炒蛋，再炒番茄，合炒调味。", config);
      assert.equal(recipe.source, "（粘贴文字）");
      assert.equal(recipe.steps.length, 3);
      assert.ok(fs.existsSync(files.json));
    });
  } finally {
    await llm.close();
  }
});

test("whisper 空转写会报错且不留下 paoding 临时文件", async () => {
  await withIsolatedTmp(async (root) => {
    const before = new Set(paodingTmpEntries(root));
    const config = createConfig(root, "http://127.0.0.1:9/v1");
    const input = path.join(root, "empty.mp4");
    fs.writeFileSync(input, "fake video\n");

    await withEnv({ PAODING_FAKE_WHISPER_EMPTY: "1" }, async () => {
      await assert.rejects(
        () => processVideo(input, config),
        /空转写/,
      );
    });
    assertNoNewPaodingTmp(root, before);
  });
});

test("LLM 首次返回非法 JSON 时会重试并成功", async () => {
  const llm = await startLlmStub({ malformedFirst: true });
  try {
    await withIsolatedTmp(async (root) => {
      const config = createConfig(root, llm.url);
      const input = path.join(root, "retry.mp4");
      fs.writeFileSync(input, "fake video\n");

      const { recipe } = await processVideo(input, config);

      assert.equal(recipe.title, "集成测试番茄炒蛋");
      assert.ok(llm.calls >= 3);
      assert.ok(llm.requests[1].messages[0].content.includes("上一次输出不是合法 JSON"));
    });
  } finally {
    await llm.close();
  }
});

test("processImages 走视觉转录并生成图片来源菜谱", async () => {
  const llm = await startLlmStub({
    imageText: "标题：集成测试番茄炒蛋\n食材：鸡蛋3个、番茄2个\n步骤：打蛋；炒蛋；炒番茄后合炒。",
  });
  try {
    await withIsolatedTmp(async (root) => {
      const config = addVision(createConfig(root, llm.url), llm.url);
      const img1 = path.join(root, "page-1.jpg");
      const img2 = path.join(root, "page-2.png");
      fs.writeFileSync(img1, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      fs.writeFileSync(img2, Buffer.from("fake png"));

      const { recipe, files } = await processImages([img1, img2], config);

      assert.equal(recipe.title, "集成测试番茄炒蛋");
      assert.equal(recipe.source_type, "image");
      assert.equal(recipe.imported, true);
      assert.equal(recipe.source, "（图片导入）");
      assert.ok(recipe.steps.every((s) => !("source_time" in s)));
      assert.ok(recipe.steps.every((s) => s.why?.reason));
      assert.ok(fs.existsSync(files.json));
      assert.ok(fs.existsSync(files.md));
    });
  } finally {
    await llm.close();
  }
});

test("processImages 在视觉读不出菜谱内容时明确报错", async () => {
  const llm = await startLlmStub({ imageText: "（未识别到菜谱内容）" });
  try {
    await withIsolatedTmp(async (root) => {
      const config = addVision(createConfig(root, llm.url), llm.url);
      const img = path.join(root, "blank.jpg");
      fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      await assert.rejects(
        () => processImages([img], config),
        /图片中未识别到菜谱内容/,
      );
    });
  } finally {
    await llm.close();
  }
});
