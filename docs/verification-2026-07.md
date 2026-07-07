# 真实视频端到端验证报告（2026-07-07）

## 摘要

- L1 环境自检：真实 29 秒油泼豆腐视频首跑暴露 whisper.cpp Metal 后端崩溃；修复后全链路跑通（下载、ASR、视觉读屏、结构化、讲解、截图、Markdown/JSON）。
- L2 真实视频：完成 3 条矩阵视频端到端验证，另有 1 条烘焙候选因 YouTube 403 放弃并换源。
- 第十五批：完成工具兜底、`source_time` 覆盖、食材图性能和配方卡 K1 正向复验；最终 `npm test` 157/157。
- 第十六批：完成 B站、无口播纯字幕、图文 URL 兜底三条中文平台真实验证；最终 `npm test` 161/161。
- 第十七批：完成管线分阶段耗时埋点、同视频性能基线、TOP 瓶颈优化、降质优化回滚和抖音路径探测；最终 `npm test` 167/167。
- 修复：所有代码修复均已 `npm test` 全绿后单独 commit。
- 收尾：保留 2 组代表产物在 `recipes/`；第十五至十七批产物在 gitignored 的 `paoding-out/`；未执行 `git push`。
- 额度：当前环境没有可查询 weekly 百分比的本地接口；按第十七批 Q1-Q4 完成后收尾。

## 第十七批性能优化与抖音探测

按 `docs/handoff-2026-07-batch17.md` 的 Q1 → Q4 顺序执行。核心纪律为先测量再优化、同视频前后对比、质量下降即回退。最终 `npm test` 为 167/167 通过；未执行 `git push`。当前环境仍没有可查询 weekly 百分比的本地接口。

### Q1 耗时剖析

已新增管线阶段耗时记录：视频/文字/图片管线会写入 `recipe.timings`，CLI 结束时打印固定顺序耗时表。覆盖阶段包括 `acquire`、`transcribe`、`vision`、`structure`、`explain`、`step_images`、`ingredient_images`、`total`。纯函数和管线落盘均有测试覆盖。

基线视频复用第十六批已跑通的 B站短视频：

```bash
PAODING_INGREDIENT_IMAGE_TIMEOUT_MIN=1 node bin/paoding.mjs "http://www.bilibili.com/video/av114814995141749" --images --keep-transcript --out paoding-out/batch17-baseline
```

结果为《手撕包菜》，8 个食材、7 步，`source_time_coverage` 为 7/7。阶段耗时：

| 阶段 | 耗时 |
|---|---:|
| acquire | 5.8s |
| transcribe | 88.0s |
| vision | 194.0s |
| structure | 122.7s |
| explain | 55.4s |
| step_images | 180.0s |
| total | 646.0s |

TOP 瓶颈为视觉读屏和步骤图挑帧，其中步骤图阶段 3 分钟超时，只产出 3/7 张步骤图。

### Q2 优化与回滚

尝试 1：短视频减少视觉读屏帧数。该优化使 `vision` 从 194.0s 降到 122.1s，`total` 从 646.0s 降到 596.0s，但质量下降：步骤从 7 步变 6 步，`source_time_coverage` 从 7/7 降到 5/6，且把调味出锅合并为无时间戳步骤。已按纪律用 `d25ca70` 回滚 `ff3daf9`。

尝试 2：短视频步骤图跳过逐步 VL 挑帧，直接用每步时间段内偏后候选帧；长视频仍按步骤跨度保留 1/2/4 个候选。复验同一视频：

```bash
PAODING_INGREDIENT_IMAGE_TIMEOUT_MIN=1 node bin/paoding.mjs "http://www.bilibili.com/video/av114814995141749" --images --keep-transcript --out paoding-out/batch17-stepimg-opt
```

结果为《手撕包菜》，8 个食材、8 步，`source_time_coverage` 为 8/8，步骤图覆盖 8/8。未见质量下降。阶段耗时对比：

| 指标 | 基线 | 优化后 | 变化 |
|---|---:|---:|---:|
| total | 646.0s | 582.1s | -63.9s |
| step_images | 180.0s | 1.0s | -179.0s |
| 步骤图覆盖 | 3/7 | 8/8 | 提升 |
| source_time 覆盖 | 7/7 | 8/8 | 持平/提升 |

注：优化后 `structure`、`explain` 受 LLM 波动比基线更慢，且食材图阶段继续跑到 60s 超时，所以总耗时净收益小于步骤图阶段收益。

### Q3 抖音路径探测

公开网页搜索未找到稳定做菜直链：`site:douyin.com/video` 查询无可用结果；抖音搜索页返回 330KB CSR 壳，未暴露视频 ID；搜索接口 `/aweme/v1/web/search/item/` 返回 `blocked`。

yt-dlp 当前版本 `2026.06.09` 的 Douyin extractor 可用，两个公开视频直链均能抽到元数据和视频格式：

| URL | 结果 |
|---|---|
| `https://www.douyin.com/video/6961737553342991651` | `extractor=Douyin`，19s，标题 `#杨超越 小小水手带你去远航❤️` |
| `https://www.douyin.com/video/6982497745948921092` | `extractor=Douyin`，42s，标题 `这个夏日和小羊@杨超越 一起遇见白色幻想` |

`/api/parse-url` 实测：

| 输入 | 结果 |
|---|---|
| `https://v.douyin.com/i5w3MNdX/` | 短链解析到抖音首页，视频抓取失败后走文字兜底；网页质量门槛拒绝站点壳，错误提示用户复制帖子文字到「粘贴文字」解析。 |
| `https://www.douyin.com/video/6961737553342991651` | 直链能进入下载、ASR 和结构化阶段；因样本不是做菜内容，不能作为正向菜谱验收。该跑暴露服务端 bug：结构化阶段失败也会被错误地转文字兜底并覆盖原始错误。 |

已修复：视频 URL 仅在 `yt-dlp`/下载抽取失败时转文字兜底，ASR、结构化、LLM 等后续阶段错误保留原始错误，避免用站点壳错误掩盖真实失败。README/README.en 已补充抖音限定语：抖音直链依赖 `yt-dlp` 当前支持，短链/搜索页/登录墙可能失败，建议上传本地视频或粘贴正文。

### 第十七批修复清单

| Commit | 类型 | 内容 | 验证 |
|---|---|---|---|
| `cb954f2` | 可观测性 | 记录管线阶段耗时并在 CLI 打印耗时表。 | `npm test` 165/165 |
| `ff3daf9` / `d25ca70` | 回滚 | 短视频减少视觉帧数虽提速但导致步骤和时间戳质量下降，已回滚。 | `npm test` 166/166 |
| `86c6b77` | 性能 | 短视频步骤图跳过 VL 挑帧，使用单候选帧；同视频总耗时 646.0s → 582.1s，步骤图 180.0s → 1.0s。 | `npm test` 166/166 |
| `5b7e6ff` | 兜底准确性 | 视频 URL 只在下载抽取失败时转文字兜底，结构化/ASR 等错误不再被站点壳兜底覆盖。 | `npm test` 167/167 |

## 第十六批中文平台验证

按 `docs/handoff-2026-07-batch16.md` 的 P1 → P4 顺序执行。中文平台真实验证覆盖 B站视频、无口播纯字幕视频、图文 URL 兜底。每个代码修复均在 `npm test` 全绿后单独提交；最终本批收尾前 `npm test` 为 161/161 通过。未执行 `git push`。当前环境仍没有可查询 weekly 百分比的本地接口，按三条真实入口验证完成后收尾。

### P1 B站 + cookies

搜索与 cookies 结果：

| 命令/动作 | 结果 |
|---|---|
| `yt-dlp "bilisearch5:家常菜 教程"` | B站搜索返回 HTTP 412。 |
| `yt-dlp --cookies-from-browser chrome "bilisearch5:家常菜 教程"` | 仍遇到 412；verbose 日志显示本机 Chrome cookies 里大量条目无法解密，实际可用 cookies 为 0。 |
| `yt-dlp "bilisearch10:快手菜 教程"` 等换词搜索 | 可返回候选，选中 `BV1mAGjzBEaZ` / `av114814995141749`，标题《【2分钟爆炒出饭店味！手撕包菜】》，时长 133.8 秒。 |

正式全链路命令：

```bash
PAODING_INGREDIENT_IMAGE_TIMEOUT_MIN=1 node bin/paoding.mjs "http://www.bilibili.com/video/av114814995141749" --images --keep-transcript --out paoding-out/batch16-p1
```

结果：成功输出《手撕包菜》，8 个食材、7 个步骤，`source_time_coverage` 为 7/7。B站视频下载、中文 ASR、视觉读屏、结构化和 Markdown/JSON 均跑通；步骤图阶段在超时保护下产出 `step-1.jpg` 到 `step-3.jpg`，其余步骤图跳过，不阻塞主结果落盘。

本项暴露 2 个真实问题并已修复：

| 问题 | 修复 | Commit | 验证 |
|---|---|---|---|
| B站 412 报错缺少用户可操作提示 | yt-dlp 错误格式化增加 B站 412 说明，提示设置 `PAODING_COOKIES_FROM_BROWSER=chrome`、确认浏览器登录，并说明 cookies 可能解密失败或过期。 | `58b7818` | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` 159/159 |
| `--images` 图片阶段可能长时间阻塞 JSON/MD | 视频管线改为解释完成后先写 JSON/MD；步骤截图和食材图增加阶段级超时，图片失败只降级为 warning。 | `58b7818` | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` 159/159 |

### P2 无口播纯字幕

由于 B站相关搜索多次受 412 影响，本项用公开无口播中文烹饪视频验证同一产品能力：

```bash
node bin/paoding.mjs "https://www.youtube.com/watch?v=6fmfB1D4rAk" --keep-transcript --out paoding-out/batch16-p2
```

视频为《【沉浸式做粉】鲜虾肉末汤米粉，酸辣开胃瞬间治愈 | 无声烹饪 ASMR Cooking: Savory Shrimp & Pork Rice Noodle Soup (No Talking)》，时长 136 秒。结果：成功输出《鲜虾肉末汤米粉》，11 个食材、6 个步骤，`source_time_coverage` 为 5/6。

关键观察：

- ASR 仅 89 字，主要是重复的“字幕志愿者 李宗盛”，没有可用口播信息。
- 视觉读屏 693 字，识别出“猪肉沫”“酱油”“加入水”“水开放入米粉”“葱花、小米辣、白胡椒”等关键画面文字，足以支撑结构化菜谱。
- 仍有少量视觉误读和用量缺失，成品可用但需要标注“视频未明确”的食材较多。

### P3 小红书图文兜底

小红书真实入口验证结论：

| 输入 | 结果 |
|---|---|
| 小红书搜索页 `https://www.xiaohongshu.com/search_result?...` | 公开 HTML 主要是应用壳，未获得稳定公开 note 链接。 |
| `https://www.xiaohongshu.com/explore/65f6a74b0000000012035a67` | yt-dlp 返回 `No video formats found!`；网页文字是“小红书 - 你访问的页面不见了”和页脚导航，旧逻辑会误把 745 字站点样板当正文。 |

已修复 URL 文字兜底质量门槛：页面不存在、登录墙、站点样板、缺少菜谱信号时直接失败，并提示用户复制帖子文字到“粘贴文字”解析。

| 问题 | 修复 | Commit | 验证 |
|---|---|---|---|
| 图文 fallback 接受小红书空壳/404 页脚 | 增加 `unusableRecipeTextReason`，拒绝页面不存在、登录墙、样板导航和缺少菜谱信号的网页文本。 | `5fc62b3` | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` 160/160 |
| 文字/图文来源没有真实时间轴，模型仍可能编造 `source_time` | `processText` 对文字来源统一删除步骤级 `source_time` 和覆盖率字段，只给真实视频保留时间戳。 | `211be17` | `node --test test/pipeline.test.mjs`，`npm test` 161/161 |

正向兜底复验使用公开菜谱文章：

```bash
curl -sS -X POST "http://127.0.0.1:4186/api/parse-url" \
  -H "Content-Type: application/json" \
  --data '{"url":"https://www.douguo.com/cookbook/3201014.html","images":false}'
```

结果：yt-dlp 对文章 URL 报 `Unsupported URL` 后，服务继续走网页文字抽取和文字管线。最终任务 `83e3fcb5-939e-44de-bbf6-bbb3c5a1c4ba` 完成，输出《高钙豆乳云朵面包》，9 个食材、11 个步骤；复验 JSON 中 0 个步骤带 `source_time`，且无 `source_time_coverage` 字段。产物位于 `paoding-out/batch16-p3-recipes/高钙豆乳云朵面包.{json,md}`。

## 第十六批修复清单

| Commit | 类型 | 内容 | 验证 |
|---|---|---|---|
| `58b7818` | 稳定性/错误提示 | 视频主结果先落盘，图片阶段增加超时降级；B站 412 增加 cookies 友好提示。 | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` 159/159 |
| `5fc62b3` | 图文兜底 | URL 文字抽取拒绝小红书空壳、404 页脚、登录墙和缺少菜谱信号的样板页。 | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` 160/160 |
| `211be17` | 时间戳诚实性 | 文字/图文来源删除模型编造的 `source_time` 和覆盖率，只在视频来源保留真实时间轴。 | `node --test test/pipeline.test.mjs`，`npm test` 161/161 |

## 第十五批补充验证

按 `docs/handoff-2026-07-batch15.md` 的 O1 → O4 顺序执行。每个代码修复均在 `npm test` 全绿后单独提交；最终本批收尾前 `npm test` 为 157/157 通过。未执行 `git push`。当前环境仍没有可查询 weekly 百分比的本地接口，按真实视频验证完成后收尾。

### O1-O3 修复结果

| 项 | 结果 | Commit | 验证 |
|---|---|---|---|
| O1 甜品/烘焙工具兜底 | 增加纯规则 `inferBakingToolFallback`，只在甜品/烘焙上下文触发；按步骤动作补打蛋器、模具、筛网、烤箱、深烤盘、裱花袋、耐热盆、烤架、刮刀等，并标 `inferred: true`。 | `523169a` | `node --test test/backend.test.mjs`，`npm test` |
| O2 `source_time` 覆盖 | 强化结构化 prompt：每一步优先使用真实时间标记，禁止外推；`processVideo` 写入 `source_time_coverage` 并记录 `N/M 步有时间戳`。 | `f1f8340` | `node --test test/backend.test.mjs test/pipeline.test.mjs`，`npm test` |
| O3 食材图性能 | 食材特写裁剪改为受控并发，复用同帧 JPEG/尺寸信息；单个食材失败不重试且不影响整批。 | `f7e155d` | `node --test test/backend.test.mjs`，`npm test` |

### O4 配方卡正向复验

候选搜索最多 4 条，本次第 3 条命中真实配方卡：

| 序号 | 视频 | 低成本检查 |
|---:|---|---|
| 1 | `https://www.youtube.com/watch?v=N33qDw2doeQ` 奶茶公式，4:01 | 有零散比例文字，但没有稳定完整配方卡，未跑全链路。 |
| 2 | `https://www.youtube.com/watch?v=oqpPiU6LNmg` 奶茶，1:10 | 只有步骤字幕/局部标注，没有完整配方卡，未跑全链路。 |
| 3 | `https://www.youtube.com/watch?v=Hh0HZPaxyEo` 万能面包配方，6:44 | 片头 10-30 秒有清晰“万能面包配方表”，进入全链路。 |

正式全链路命令：

```bash
node bin/paoding.mjs "https://www.youtube.com/watch?v=Hh0HZPaxyEo" --images --keep-transcript
```

结果：成功输出《万能面包配方》，共 9 步，用时 957.6s；输出在 gitignored 的 `paoding-out/万能面包配方.{json,md}`。该正式跑暴露了 3 个真实视频问题：片头配方表采样窗口过短、多图批量读屏会漏掉表格、模型把配方卡标记放在段尾或漏给部分食材 source note。已继续修复并分别提交。

| 问题 | 修复 | Commit | 验证 |
|---|---|---|---|
| 漏采 10-30 秒片头配方表 | 配方卡专项抽帧从前 5 秒扩到前 30 秒窗口，保留片尾抽帧。 | `a193b57` | `npm test` 155/155 |
| 多图读屏漏表格 | 视觉读屏批大小降到 3。 | `3903add` | `npm test` 156/156 |
| 模型漏/错放 `【画面配方卡】` | 对含配方表标题和 3 个以上用量的视觉文本补标记，并把段尾标记规整到段首。 | `c8f3399`、`f241be2` | `npm test` |
| 片头单帧仍有偶发漏读 | 前 3 张片头专项帧逐张 OCR；若普通读屏未读出足够配方卡用量，用更强 OCR prompt 重试。 | `9305e9c`、`f085651` | `npm test` 157/157 |
| 食材 note 留痕不完整 | 根据配方卡文本里的用量 token 或食材名匹配，为对应食材补 `出处：画面配方卡`，覆盖合并用量如牛奶 75g+75g→150ml。 | `f241be2`、`7a514c4` | `npm test` 157/157 |

当前代码复验：复用真实视频 ASR 文本和当前视觉读屏，`visionTranscript` 成功读出 `【画面配方卡】`，包含高粉 150g、牛奶 75g、白砂糖 60g、黄油 36g 等；结构化级复验得到 8/8 个食材带 `出处：画面配方卡`，`source_time_coverage` 为 13/13。K1 正向路径判定为 ✅。

## L1 环境自检

| 输入 | 结果 | 发现 |
|---|---|---|
| `https://www.youtube.com/watch?v=29SLDdjfnQY` 油泼豆腐，29 秒，`--images --keep-transcript` | 修复后成功，输出 4 步、4 张步骤图、1 张食材图，用时 434.0s | 首跑 ASR 在 whisper large-v3-turbo + Metal 下 `ggml_metal_buffer_init` 分配失败并退出；已修复自动 `--no-gpu` 降级。另发现普通调味料 ASR 近音词仍有质量问题，如“烟/急紧/生手酱油”。 |

## L2 验证矩阵

| 场景 | 视频 | 用时 | 验收结果 |
|---|---|---:|---|
| 饮品/奶茶 | 珍珠烤奶热饮 `https://www.youtube.com/watch?v=7A8CFERIJK0` | 779.0s | K1 ⚠️ 候选视频没有真实配方卡，视觉转录明确写“配料表/配方卡：无明确信息”；口播用量完整进入菜谱。K2 ⚠️ 未触发 `batch_info/phase`，该视频先泡 400ml 茶汤再取 200ml 组装，是否应拆 batch/serving 边界不够明确。 |
| 香料炖菜/卤味 | 西红柿炖牛腩 `https://www.youtube.com/watch?v=bFv3MNsoGgA` | 806.5s | J1 首跑 ❌ `白纸` 藏在“香料包” note 中未纠正；已修复 note 内香料同音字清洗，保留产物已刷新为 `白芷（转写作「白纸」，已按烹饪常识纠正）`。J2 ⚠️ 本视频没有“拇指长/指甲盖大”描述；“十字刀”保留。`垫白纸吸油` 防误改由 stub 测试覆盖。 |
| 甜品烘焙 | 松软香甜的戚风蛋糕 `https://www.youtube.com/watch?v=R-J1THaPWU8` | 592.6s | I 批 ⚠️ 用量和步骤基本可用，难度 medium 合理；tools 不完整，只列出电动打蛋器、烤箱，漏掉模具、筛网/面粉筛、烤架、盆等，`total_time_min` 也未估出。首跑还暴露步骤编号跳号，已修复并刷新保留产物。 |

### 通用检查

- `source_time`：所有保留/检查产物没有超过视频片长；但香料和烘焙视频后半段多步缺失 `source_time`，导致部分步骤无配图。
- `confidence/风险`：能标出炒糖色、打发蛋白、烘烤等高风险步骤，整体合理。
- 画面配图：三条矩阵视频均能产出步骤图或食材图；食材图阶段非常慢，饮品/香料均在最后图片阶段耗时数分钟。
- Markdown：结构完整，可打开查看；已保留 2 组代表产物。
- 营养估算：本次 CLI 真实视频未单独触发 `/api/nutrition`；现有 stub 测试覆盖营养接口和缓存失效。

## 修复清单

| Commit | 类型 | 内容 | 验证 |
|---|---|---|---|
| `e59508f` | 环境/代码稳定性 | whisper.cpp Metal 崩溃时自动使用 `--no-gpu` 重试；新增 `PAODING_WHISPER_NO_GPU` 强制开关；错误包含 signal/stderr 尾部。 | `node --test test/pipeline.test.mjs`，`npm test` |
| `d05d04b` | 清洗漏洞 | `ingredientFix` 纠正食材 note 中的香料同音错字，修正 `转写作「原词」`，且不把 note 命中词传播到步骤文本，避免“白纸吸油”误改。 | `node --test test/backend.test.mjs`，`npm test` |
| `cba5555` | 清洗漏洞 | 结构化步骤按数组顺序重编号，避免 LLM 输出 1/7/10/13 这类跳号进入 Markdown 和图片名。 | `node --test test/pipeline.test.mjs`，`npm test` |

## 保留产物

- `recipes/西红柿炖牛腩.json`、`recipes/西红柿炖牛腩.md`、`recipes/西红柿炖牛腩/`
- `recipes/松软香甜的戚风蛋糕.json`、`recipes/松软香甜的戚风蛋糕.md`、`recipes/松软香甜的戚风蛋糕/`

已清理：L1 `油泼豆腐`、饮品 `珍珠烤奶热饮` 产物。

## 遗留问题与建议

1. 普通调味料 ASR 近音词仍有缺口，如油泼豆腐里“盐/鸡精/生抽”等被识别成近音词后未完全纠正。建议扩充低风险调味料词表，但要避免把真实“白汤/烟熏”等误改。
2. `source_time` 仍坚持诚实原则：第十五批已加强 prompt 并增加覆盖率统计，但模型确实找不到真实时间标记时仍会留空，不做后处理外推。
3. 食材图阶段已改为受控并发并减少重复工作；第十六批进一步增加阶段级 timeout 和主结果先落盘，避免图片阶段阻塞 JSON/MD。
4. 第十五批已完成真实配方卡 K1 正向复验，并补齐烘焙工具兜底；后续应继续覆盖其它类型配方卡（饮品、片尾材料清单、竖屏短视频）避免只对面包样本过拟合。
5. 第十六批确认中文平台入口可跑通核心路径，但 B站搜索和 Chrome cookies 受 HTTP 412/本机 cookies 解密失败影响仍不稳定；小红书公开页经常只有应用壳或登录墙，产品上应继续强化“复制正文解析”的引导。
