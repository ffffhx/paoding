<div align="center">

<img src="app/icons/icon-512.png" width="112" alt="Paoding" />

# Paoding

**Turn cooking videos into step-by-step recipes that explain why each move matters.**

_Paste a video, text post, screenshot, or photo. Paoding extracts the recipe, explains the cooking logic, and gives you a focused cook-along app._

<p>
<img src="https://img.shields.io/badge/license-MIT-E4572E" />
<img src="https://img.shields.io/badge/PWA-installable-6A8D3F" />
<img src="https://img.shields.io/badge/local-Ollama%20%2B%20whisper.cpp-2A2724" />
<img src="https://img.shields.io/badge/Node-22%2B-8A817A" />
<img src="https://github.com/ffffhx/paoding/actions/workflows/test.yml/badge.svg" alt="test" />
</p>

<p>
<a href="README.md"><img src="https://img.shields.io/badge/Language-Chinese-E4572E" alt="Language: Simplified Chinese" /></a>
<a href="README.en.md"><img src="https://img.shields.io/badge/Language-English-2A2724" alt="Language: English" /></a>
</p>

<img src="docs/assets/cook.gif" width="300" alt="Cook mode demo" />

</div>

---

## What It Is

Paoding accepts cooking videos from Bilibili, Douyin, YouTube, local files, pasted text, recipe posts, screenshots, and photos. It then:

1. Transcribes speech or reads text and images.
2. Structures the content into a recipe with ingredients, quantities, heat, timing, doneness cues, and source timestamps.
3. Explains each step with "why this works", "what fails if skipped", and "how to tell it is done".
4. Serves the result in a mobile and desktop cook-along app with one-step-at-a-time mode, voice controls, timers, highlighted ingredients, notes, shopping lists, and AI Q&A.

## Why It Is Different

Most video-to-recipe tools produce a flat recipe: they tell you what to do, not why it works. Editorial cooking sites explain technique well, but they do not turn the random cooking video you just found into a learning-friendly recipe.

Paoding combines automatic parsing with step-level cooking reasoning. You can follow the recipe, but you can also learn why the oil temperature matters, why blanching helps, and which shortcuts are risky.

| Dimension | Paoding | Mealie v3.13+ | ReciMe / Deglaze style apps | ATK / ChefSteps style sites |
|---|---|---|---|---|
| Video audio transcription | Yes | Yes | Yes | No |
| Visual/OCR understanding | Optional | No | Rare or unclear | No, editorial content |
| Per-step source screenshots | Yes | No | Rare | Editorial only |
| Step-by-step why explanations | Yes | No | No | Yes, manually edited |
| Chinese platforms | First-class | No | No | No |
| Self-hosted no-cost setup | Ollama + whisper.cpp | Open-source and mature | Commercial apps | Content sites/courses |
| Multi-user/i18n maturity | Household token isolation; i18n in progress | Strong | Product-dependent | Not recipe management |

<div align="center">
<img src="docs/assets/why.png" width="300" alt="Step explanations" />
</div>

## Features

| Area | What Paoding Provides |
|---|---|
| Smart import | Parse links, uploads, pasted text, web posts, screenshots, and recipe photos with live job progress and queueing. |
| Visual fallback | Optional vision model support for on-screen subtitles, recipe images, step screenshots, and ingredient close-ups. |
| Cook mode | One step per screen, large type, keep-awake, swipe navigation, resume progress, highlighted ingredients, and source timestamp jumps. |
| Explanations | Three-part reasoning for each step, key heat/time/quantity highlights, and tappable cooking terms. |
| Technique library | Aggregates recurring techniques across recipes and can summarize when to use them, key cues, and common failure points. |
| AI helper | Ask about a step, rescue a failed dish, substitute ingredients, design the whole dish, or estimate nutrition. |
| Tools and equipment | Dessert/baking-focused tool lists for mixers, piping bags, spatulas, molds, and similar equipment; alternatives include tradeoffs, no-alternative items include the reason, and inferred items are marked. |
| Pantry and planning | Scalable structured quantities, Chinese-unit reference, merged shopping lists by aisle, weekly meal planning, and multi-dish timelines. |
| Editing and records | Edit titles, ingredients, steps, explanations, tags, notes, ratings, favorites, and cook history. |
| Sync and backup | Shared recipes plus token-isolated household user data; export/import backup; automatic server backups. |
| Interop | Import schema.org Recipe JSON-LD; export Markdown, Cooklang, schema.org JSON-LD with standard HowTo `tool`, print/PDF with tools, and public read-only share pages. |
| Self-hosting | Plain Node app, Docker/Compose, PWA, and runtime-configurable Android APK. |

<div align="center">
<img src="docs/assets/home.png" width="270" alt="Home screen" />&nbsp;&nbsp;
<img src="docs/assets/dark.png" width="270" alt="Dark mode" />
</div>

## Quick Start

Requirements: Node 22+, `ffmpeg`, `yt-dlp` for online links, and an OpenAI-compatible LLM plus ASR backend.

### Scheme A: Fully Local No-Cost Setup

```bash
# LLM through Ollama's OpenAI-compatible endpoint
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b   # optional vision model

# Local speech recognition
brew install whisper-cpp ffmpeg yt-dlp
mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

# Configure
cp .env.example .env
openssl rand -hex 16  # put the value in PAODING_API_TOKEN

# Run the app
node app/server.mjs
```

Open the printed local/LAN URL in a browser. On a phone in the same Wi-Fi network, add it to the home screen for a full-screen PWA.

Optional: set `PAODING_OUTPUT_LANG=en` to ask the LLM to generate structured recipes, step explanations, nutrition estimates, technique summaries, and AI helper answers in English. The frontend language is switched in the app settings; date and number formatting are not localized yet.

### Scheme B: Command Line

```bash
node bin/paoding.mjs ./braised-pork.mp4
node bin/paoding.mjs "https://www.bilibili.com/video/BVxxxx" --depth advanced
```

### Scheme C: Docker Compose

```bash
cp .env.example .env
openssl rand -hex 16  # put the value in PAODING_API_TOKEN

mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

docker compose up --build
```

If Ollama already runs on the host, the default Docker LLM base URL can point to `http://host.docker.internal:11434/v1`. Compose can also start Ollama with the `ollama` profile.

## Configuration Notes

- Set `PAODING_API_TOKEN` for any LAN or public deployment. `PAODING_API_TOKENS=alice:token1,bob:token2` enables household user isolation.
- Set `PAODING_VISION_MODEL` to enable screenshot/photo OCR and visual step images.
- Set `PAODING_COOKIES_FROM_BROWSER=chrome` if a video platform requires logged-in browser cookies.
- Jobs, recipes, user data, and backups are stored as local files. See `.env.example` for paths and limits.

## Private Deployment Note

The Chinese README contains a private deployment section for the author's own Caddy, launchd, autossh tunnel, and self-hosted runner setup. It is intentionally not translated as a reusable deployment guide. For general self-hosting, prefer the Node or Docker instructions above.

## Project Layout

```text
src/            Parsing engine: download, text fetch, ASR, recipe structuring, explanations, pipeline
bin/paoding.mjs CLI entry
app/            PWA/cook-along app and Node server
android/        Capacitor Android project
Dockerfile      Self-hosted image
docs/           Product and technical notes
```

## Tests

```bash
npm test
# Equivalent to: node --test test/*.test.mjs
```

The test suite uses Node's built-in test runner and local fakes/stubs for external binaries and OpenAI-compatible model APIs. It covers pure parsing helpers, server APIs, frontend logic, schema.org import/export, image import, technique aggregation, backup behavior, and pipeline integration.

## Roadmap Snapshot

- Done: text posts, video fallback, Android/PWA shell, sync and backup, editing, quantity scaling, shopping lists, dessert-focused tool/equipment lists with alternatives, Cooklang/schema.org export, optional visual OCR, step screenshots, weekly meal planning, multi-dish timelines, household isolation, Docker/Compose, source timestamp jumps, nutrition estimates, technique library, public share pages, print/PDF, Chinese-unit references, and frontend i18n infrastructure.
- i18n status: `app/i18n.js`, `t()` fallback, zh/en dictionaries, the settings-page language selector, and userdata sync are in place. English UI coverage now includes settings, home/list views, recipe detail, cook-along mode, shopping/planning, techniques, the install banner, tag-edit modal, exported recipe text, toasts, and error prompts. Date and number formatting are intentionally not localized yet.
- Next: date/number localization, more real-world video prompt tuning, broader technique vocabulary, and higher-quality technique matching.
