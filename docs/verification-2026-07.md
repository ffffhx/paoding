# 真实视频端到端验证报告（2026-07-07）

## 摘要

- L1 环境自检：真实 29 秒油泼豆腐视频首跑暴露 whisper.cpp Metal 后端崩溃；修复后全链路跑通（下载、ASR、视觉读屏、结构化、讲解、截图、Markdown/JSON）。
- L2 真实视频：完成 3 条矩阵视频端到端验证，另有 1 条烘焙候选因 YouTube 403 放弃并换源。
- 第十五批：完成工具兜底、`source_time` 覆盖、食材图性能和配方卡 K1 正向复验；最终 `npm test` 157/157。
- 第十六批：完成 B站、无口播纯字幕、图文 URL 兜底三条中文平台真实验证；最终 `npm test` 161/161。
- 第十七批：完成管线分阶段耗时埋点、同视频性能基线、TOP 瓶颈优化、降质优化回滚和抖音路径探测；最终 `npm test` 167/167。
- 第十八批：完成讲解阶段优化、审查插队 3 个确认问题修复及 2 个疑点低风险修复；验收时 `npm test` 172/172。收官回归复验又修复 2 个真实回归点，最终 `npm test` 173/173。
- 第十九批：按凉拌、汤、面点、早餐、卤味、甜品顺序做广覆盖回归；完成 5 次端到端产物，其中 3 条强有效、1 条面点弱覆盖、1 条无效候选记录，早餐和甜品因多次 YouTube 403/格式不可用止损；S4 追加 15 分钟长视频压测，暴露多道菜合集结构化压缩问题并修复，最终 `npm test` 177/177。
- 修复：所有代码修复均已 `npm test` 全绿后单独 commit。
- 收尾：保留 2 组代表产物在 `recipes/`；第十五至十九批和 S4 产物在 gitignored 的 `paoding-out/`；未执行 `git push`。
- 额度：当前环境没有可查询 weekly 百分比的本地接口；第十九批按每条视频后记录该限制，并在甜品连续下载阻断后止损收尾。

## 第十九批广覆盖回归

按 `docs/handoff-2026-07-batch19.md` 的 S1 → S3 执行，顺序为凉拌、汤、面点、早餐、卤味、甜品。命令行环境无法读取状态栏 weekly 百分比；本批每条结束后均按报告记录该限制，甜品第二个候选仍失败后停止继续消耗额度。所有产物保留在 gitignored 的 `paoding-out/`，未执行 `git push`。

### S1 视频矩阵结果

| 类型 | 来源与产物 | 结果 | 检查结论 |
|---|---|---|---|
| 凉拌菜 | YouTube `oJ8ZXxVLgeE`；`paoding-out/batch19-s1-01-cold/凉拌黄瓜.json` | 13 食材、9 步，`source_time` 6/9，步骤图 5/9，总耗时 658.2s | 生活化定量保留，如黄瓜两根、香菜三根、适量/少许；简单菜被拆成 9 步略细但动作真实。技法命中泡发、炸制、焯水、过冷水、拍松、拌匀。 |
| 汤类候选 | YouTube `yDEK9HPtgYI`；`paoding-out/batch19-s1-02-soup/西红柿鸡蛋汤.json` | 4 食材、1 步，步骤图 1/1，总耗时 363.5s | 无效候选：转写主要是“中文字幕志愿者”重复，视觉只看到切番茄和疑似水量卡。归为源质量问题，不计入汤类通过。 |
| 汤类有效 | YouTube `iMuoVqbFMI0`；`paoding-out/batch19-s1-02-soup-voice/西红柿鸡蛋汤.json` | 9 食材、10 步，`source_time` 10/10，步骤图 9/10，总耗时 688.6s | 火候和时序完整：炒葱花、炒西红柿出汁、加水、调味、勾芡、流线状入蛋液都保留。技法命中切配、炒出汁、勾芡、淋蛋成花。 |
| 面点 | 原始 YouTube `pwCqMkZfVTE` 默认下载 403，手动 m3u8 下载后跑本地文件；`paoding-out/batch19-s1-03-dumpling-wrapper/饺子面剂制作.json` | 1 食材、3 步，`source_time` 3/3，步骤图 1/3，总耗时 241.4s | 弱覆盖：样本只有短段饺子面剂/擀皮/切剂，未覆盖完整揉面、醒面流程。作为面点技法样本有效，触发擀制、切配补词。 |
| 早餐 | `heHonZ1CYpc`、`uCFHHZd0d1w`、`T7btx11e_JU`、`wcWWe7ztUy4` | 无产物 | 4 个鸡蛋饼/三明治候选均在下载阶段遇到 YouTube 403；为控制额度未继续扩大搜索。 |
| 卤味/多香料 | YouTube `sFSyjw4ooZE`；`paoding-out/batch19-s1-05-braise/卤鸡腿.json` | 20 食材、8 步，`source_time` 8/8，步骤图 7/8，总耗时 826.8s | 香料同音字纠错继续有效，如干沙姜→山柰、肉寇→肉豆蔻；长时间浸泡和保存卤水保留。技法命中滑油、炸制、卤制、浸泡入味。 |
| 甜品 | `wXb1QawzO54`、`7Q6gh3wVUS4` | 无产物 | 布丁候选默认下载 403；第二条尝试 m3u8 格式后仍报 requested format unavailable。本轮未新增甜品工具清单复验，沿用前批戚风/面包验证结论，列为遗留。 |

### S2 问题分流

- 代码修复：真实样本暴露技法漏词，已用 `fd5b987` 扩充 `src/techniques.mjs`，新增 `拌匀`、`擀制`、`炒出汁`、`淋蛋成花`、`卤制`、`浸泡入味` 6 个技法条目，并补充勾芡、切配、拍松、揉面、醒发等别名；词表总数为 44 项。
- 测试：`test/techniques.test.mjs` 增加凉拌、面点、汤、卤味真实文本命中断言；先发现“浸泡”别名会把泡发误标为浸泡入味，已在同一修复提交中收窄为“泡在卤汁/泡在卤水/浸泡入味”等上下文词。
- 非代码问题：早餐、甜品和部分面点候选被 YouTube 403/格式不可用阻断；手动 m3u8 对一条面点视频可恢复，但是否在产品下载阶段自动做 m3u8 fallback 需要单独设计和回归，未在终批冒险改 acquire 逻辑。
- 源质量问题：汤类首条候选转写污染严重，结构化输出只有 1 步；判定为视频/字幕源质量问题，不改 prompt。
- 配图观察：1 分钟食材图 timeout 下多条真实视频食材图为 0 张，但主 JSON/MD 先落盘、步骤图仍可用；作为性能与质量权衡遗留，不影响本批代码正确性。

### S3 收尾验证

- `node --test test/techniques.test.mjs`：4/4 通过。
- `npm test`：173/173 通过。
- Roadmap 最后一项已按本轮真实覆盖范围勾选。

### S4 长视频压测

追加覆盖此前未测的 15-30 分钟完整教学视频。先用 `yt-dlp` 搜索 `家常菜 完整教学 20分钟`、`年夜菜 完整教学 家常菜`、`宴客菜 完整教学 20分钟`；B站搜索 `bilisearch20:家常菜 完整教学` 返回 HTTP 412。第一候选 YouTube `jhqadGY-Kcc`（958s）在下载阶段遇到 `HTTP Error 403: Forbidden`，未产出。正式样本改用 YouTube `fKGKCl79ZkQ`，标题《招待親朋好友必吃的20道家常菜，簡直絕了（附時間軸）》，时长 902s。

正式端到端命令：

```bash
PAODING_INGREDIENT_IMAGE_TIMEOUT_MIN=1 node bin/paoding.mjs "https://www.youtube.com/watch?v=fKGKCl79ZkQ" --images --keep-transcript --out paoding-out/batch19-s4-long
```

原始结果：成功落盘 `paoding-out/batch19-s4-long/黄焖鸡.{json,md}`，但只输出《黄焖鸡》5 个食材、6 步，所有 `source_time` 都在 0-35s 内；步骤图 0/6，食材图 1 分钟超时后降级，主 JSON/MD 正常落盘。阶段耗时如下：

| 阶段 | 耗时 | 占比 |
|---|---:|---:|
| acquire | 278.5s | 20% |
| transcribe | 599.8s | 44% |
| vision | 171.4s | 12% |
| structure | 182.5s | 13% |
| explain | 43.0s | 3% |
| step_images | 40.8s | 3% |
| ingredient_images | 60.0s | 4% |
| total | 1376.1s | 100% |

压测检查结论：

- 超长转写没有截断：`_transcript` 9408 字、577 行，从 `[00:00]` 到 `[15:00]`，包含 `第一道` 到 `第二十道`，尾部能看到第十八、十九、二十道。
- 结构化质量首跑不合格：LLM 只整理第一道黄焖鸡，丢弃后 19 道；`source_time_coverage` 虽为 6/6，但只覆盖片头 35 秒，属于“诚实但不完整”。
- 视觉读屏发现误报：普通画面被写成 `【画面配方卡】`，且内容是“未标注具体数量、可以推测需要一定量”，旧逻辑会把这种无具体用量的伪配方卡提升为高优先级输入。
- 抽帧预算首跑无法验证长视频片尾分布：因结构化只给出片头 6 步，步骤图只在片头短区间抽帧并被 VL 判定拒绝；修复后未再完整跑一遍 20 分钟级图片链路，以控制额度。

代码修复：`e5d98b9 fix: preserve multi-dish long video structure`。

- `extractRecipeCardTranscript` 只接受含具体数字+单位用量的 `【画面配方卡】` 段，过滤“未标注具体数量/推测一定量”这类视觉误报。
- 从时间戳转写中提取 `第一道/第二道/...` 多道菜目录，注入结构化 prompt，要求每道至少 1 个步骤。
- 增加确定性 fallback：当检测到 3 道以上合集而模型步骤数低于目录的 80% 时，用目录生成“每道菜一条步骤”，保留真实时间段，清空食材/工具以避免把第一道食材误当全集购物清单。

修复验证：

- `node --test test/backend.test.mjs`：53/53 通过。
- `node --test test/pipeline.test.mjs`：19/19 通过。
- `npm test`：177/177 通过。
- 复用同一条长视频 `_transcript` 做结构化级复验，输出 `paoding-out/batch19-s4-long-structure-rerun/structured-after-fallback.json`：标题为合集标题，20 步，`source_time_coverage` 为 20/20；首步 `第一道：五个女儿想吃黄焖鸡` `[3,35]`，末步 `第二十道：分享一个发面豆沙酥饼的做法` `[828,900]`，技法命中 16 项。

最终判定：长视频 ASR 能完整覆盖全片；LLM 单独面对多菜合集会压缩到第一道，必须保留目录级后处理保护。修复后结构化不会再静默丢弃后半段；图片阶段的长视频全量分布仍建议作为后续单项压测，因为本次为额度控制只做了结构化复验。

## 第十八批讲解优化与收官修复

按 `docs/handoff-2026-07-batch18.md` 的 R1 → R3 执行，并在 R2 前插入独立审查实例确认的 3 个真问题修复。每个代码修复均在测试全绿后单独提交；未执行 `git push`。当前环境仍没有可查询 weekly 百分比的本地接口。

### R1 讲解阶段优化

代码审查确认：旧版 `explainSteps` 已经是整份菜谱单次 LLM 请求，不存在“逐步骤串行请求”问题。R1 先尝试 4 步分批、最多 2 批并发，真实同视频复验不成立，已回滚：

| 尝试 | Commit | 同视频结果 | 结论 |
|---|---|---|---|
| 分批并发讲解 | `9140626` | `paoding-out/batch18-explain-opt`，9 步，`explain=91.9s`，慢于 Batch17 同视频 `78.7s` | 未带来性能收益，已用 `c24a7f7` 回滚 |
| 紧凑 prompt + 单次请求 | `fae8be8` | `paoding-out/batch18-explain-compact`，8 步，`explain=52.3s`，总计 `537.6s` | 通过，保留 |

正式保留方案是压缩 system/user prompt、改为紧凑 JSON 输入，并要求 `reason/if_not/cue` 各一句。与第十七批同视频优化后结果对比：

| 指标 | Batch17 优化后 | Batch18 紧凑讲解 | 变化 |
|---|---:|---:|---:|
| total | 582.1s | 537.6s | -44.5s |
| explain | 78.7s | 52.3s | -26.4s |
| 步骤数 | 8 | 8 | 持平 |
| why 覆盖 | 8/8 | 8/8 | 持平 |
| risk/confidence | 8/8 | 8/8 | 持平 |

质量检查：保留结果 8/8 步均有 `why.reason/if_not/cue`、`risk_level` 和 `confidence`；讲解较短但仍具体到“包菜脆嫩”“调料均匀”“花椒香气”等步骤状态。`source_time_coverage` 本次为 6/8，属于结构化阶段 LLM/视觉输入波动，不是讲解阶段改动造成；未因 R1 质量下降回退。

### 插队审查修复

独立审查实例确认的 3 个真问题均已修复：

| Commit | 严重度 | 问题 | 修复 | 验证 |
|---|---|---|---|---|
| `73a8b2e` | 高 | URL 文字兜底把标题里的“教程/菜谱”当强信号，可能放行 CSR 壳/导航页；标题或页脚含误拒词又可能误拒合法页。 | 可用性改为正文级信号：正文需有用量数字 + 烹饪动词密度；标题只做加分；误拒词仅在正文占比高时拒绝。 | `node --test test/backend.test.mjs`，`npm test` |
| `dfabbfc` | 高 | 配方卡出处只要食材名或任意用量命中整段卡文本就标，盐 4g/模型盐 2g 会误标。 | 改为配方卡同行/续行窗口匹配：食材名或常见简称与模型用量 token 必须在同一条目或续行内同时出现。 | `node --test test/backend.test.mjs`，`npm test` |
| `09dfc66` | 中 | 第十七批短视频单候选步骤图跳过 VL 后，黑屏/转场/人脸帧可能被硬配。 | 单候选帧也走一次轻量 VL yes/no；不合适、非法 JSON 或请求失败均不配图。 | `node --test test/backend.test.mjs`，`npm test` |

两个疑点也已低风险修复：

| Commit | 内容 | 验证 |
|---|---|---|
| `295be70` | 食材图定位并发下限从 2 改为 1，允许用户用 `ingredientConcurrency: 1` 或环境变量降到串行。 | `node --test test/backend.test.mjs`，`npm test` |
| `43a2cf7` | 图片阶段在 VL 返回后、裁剪/复制写盘前再次检查 AbortSignal，避免阶段超时后后台任务继续给 recipe 挂图或写图片。 | `node --test test/backend.test.mjs`，`npm test` |

注：`09dfc66` 出于质量保护恢复了短视频单候选步骤图的 VL 复核，因此第十七批 `step_images=1.0s` 是历史性能点，不应作为最新代码的步骤图耗时预期；后续若继续优化步骤图，需要在“过 VL 质量门槛”前提下重新测量。

### R3 收尾验证

- `node --test test/backend.test.mjs`：50/50 通过。
- `npm test`：172/172 通过。
- R2 总交付报告新增于 `docs/delivery-2026-07.md`。

### 收官回归复验

第十八批验收后，按 `dfabbfc`（配方卡出处同行匹配）和 `09dfc66`（单候选步骤图 VL 复核）的两条已知基准做最后复验。

| 基准 | 首次复验结果 | 修复 | 最终复验结果 |
|---|---|---|---|
| YouTube 万能面包配方 `Hh0HZPaxyEo` | `paoding-out/final-regression-bread`：8 个食材中 0 个带 `出处：画面配方卡`。排查发现不是同行匹配过严，而是片头完整配方表没有被视觉转写稳定抓到。 | `d95dea9`：配方卡补抽点改为片头 5 + 片尾 3，前 5 张片头帧逐张 OCR。`npm test` 172/172。 | `paoding-out/final-regression-bread-rerun`：视觉转写含完整 `【画面配方卡】`（高粉 150g、牛奶 75g、白砂糖 60g、全蛋液 30g、酵母 2g、奶粉 5g、盐 4g、黄油 36g），7/8 个食材带出处；盐未标来自单字食材名保护，属于合理收紧。总耗时 768.8s，`source_time_coverage` 6/8。 |
| B站手撕包菜 `av114814995141749` | `paoding-out/final-regression-bili-cabbage`：6 步中 0 张步骤图。单候选 yes/no 没有硬配黑屏，但对短视频口播/画面错位过脆。 | `937b2e0`：短视频 source_time 跨度 >=8s 时改为 2 张候选、同一次 VL 请求选择或选 0；prompt 明确允许讲解人同时出镜但需有相关食物/锅具，温度降为 0。`npm test` 173/173。 | `paoding-out/final-regression-bili-cabbage-rerun`：6 步中 4 张步骤图，`source_time_coverage` 4/6；目检 `step-1` 包菜选择、`step-2` 调料、`step-3` 锅中花椒/油、`step-4` 菜品状态，均非黑屏/转场/纯人脸。总耗时 606.8s。 |

最终收官状态：代码修复均已独立 commit，报告补录单独 commit；未执行 `git push`。

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
