# 真实视频端到端验证报告（2026-07-07）

## 摘要

- L1 环境自检：真实 29 秒油泼豆腐视频首跑暴露 whisper.cpp Metal 后端崩溃；修复后全链路跑通（下载、ASR、视觉读屏、结构化、讲解、截图、Markdown/JSON）。
- L2 真实视频：完成 3 条矩阵视频端到端验证，另有 1 条烘焙候选因 YouTube 403 放弃并换源。
- 修复：3 个独立代码修复均已 `npm test` 全绿后单独 commit。
- 收尾：保留 2 组代表产物在 `recipes/`；未执行 `git push`。
- 额度：当前环境没有可查询 weekly 百分比的本地接口；按交接要求完成 3 条真实矩阵验证后收尾。

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
3. 食材图阶段已改为受控并发并减少重复工作；若后续真实长视频仍慢，再考虑阶段级 timeout 或更细进度日志。
4. 第十五批已完成真实配方卡 K1 正向复验，并补齐烘焙工具兜底；后续应继续覆盖其它类型配方卡（饮品、片尾材料清单、竖屏短视频）避免只对面包样本过拟合。
