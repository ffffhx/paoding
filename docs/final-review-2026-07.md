# 2026-07 全分支终审报告

审查对象：`origin/main..improvements-2026-07`，最终本地 ref 为 `c8f3399 fix: tag visual recipe cards`。审查命令按要求未执行 fetch，未 push。

## 结论

本轮从最终主线树回看了约 100 个提交的功能组合、两次 merge 后的修复存活情况，以及 README 中英双语说明。发现 1 个真实问题：跨设备同步冲突合并会覆盖同一菜谱两端各自累计的 `cooked_history` / `cooked_dates` 等做饭历史，导致“我的厨房”周/月统计、连续做饭和常做菜可能丢一侧数据。本分支已修复，并补充前端合并测试。

除上述已修复问题外，未发现 AI 变体、菜谱集、库存、双板块、工具清单互相组合时会破坏 recipe/userdata 结构的确定性问题；第 12 批和第 15 批修复在最新 `improvements-2026-07` 树中均完好。

## Merge 修复核对

第 12 批三项修复均在合并后代码中保留：

- `e59508f fix: retry local whisper without gpu`：`src/transcribe.mjs` 在本地 whisper GPU/Metal 失败时降级 `--no-gpu` 重试，`src/config.mjs` 保留 `PAODING_WHISPER_NO_GPU` 配置；最终树测试包含 GPU 崩溃 CPU 重试用例。
- `d05d04b fix: correct ingredient typos in notes`：`src/ingredientFix.mjs` 继续修正食材 note 里的同音错别字，同时保护“转写作...”原文说明；最终树测试覆盖 note 修正且不误改步骤文本。
- `cba5555 fix: renumber structured recipe steps`：`src/chef.mjs` 在结构化后把步骤重新编号为连续顺序；最终树测试覆盖模型跳号步骤重编号。

第 15 批收尾修复在最新树中也保留：

- `523169a fix: add baking tool fallback`：`inferBakingToolFallback` 在甜品/烘焙上下文为打蛋器、模具、裱花袋等补齐推断工具，并避免家常蒸蛋一类误补。
- `f1f8340 fix: report source time coverage`：`processVideo` 写入 `source_time_coverage`，只统计覆盖率，不为缺失步骤补造时间戳。
- `f7e155d fix: parallelize ingredient image crops`：食材裁剪通过 `mapLimitSettled` 限并发，单个裁剪失败不影响其它食材图。
- 最新 `c8f3399 fix: tag visual recipe cards`：视觉转录漏掉 `【画面配方卡】` 标记时，会按“配方表/用料表 + 多个明确用量”补标；最终树测试已覆盖。

两次 merge 后未看到上述修复被 `-X theirs` 策略覆盖或回退。

## 跨功能一致性

- AI 菜谱变体通过服务端 `structureRecipe` 复用结构化路径，落库前统一经过 `writeRecipeFile`，因此工具清单和批量/单份 phase 会走同一套清洗逻辑；变体作为普通新菜谱进入列表、库存匹配、分享图卡和导出路径。
- 菜谱集只保存 recipe id，删除菜谱集不删除菜谱；跨设备合并用 recipe id 并集，和 AI 变体的新 id 模型兼容。
- 库存匹配按 recipe ingredients 计算覆盖率，购物清单生成时复用双板块缩放因子；库存已有项标记只影响 shopping item 的 `owned` 字段，不改 recipe 本体。
- 双板块 recipe 在前后端均要求 ingredients 和 steps 全量合法标注 batch/serving 后才启用；半拆数据会退回普通 recipe，避免购物清单和跟做模式只缩放一半结构。
- 工具清单在导入、PUT、读取、AI 工具补齐、AI 变体落库等边界统一 `normalizeTools`；schema.org 导出继续使用标准 HowTo `tool`。
- i18n 的 zh/en key 集合有测试约束，切换语言后的首页、详情、跟做、购物/计划、技法、统计、导出、toast、错误提示等路径均有覆盖；日期、时间、数字通过 Intl helper 输出。

## 本次修复

问题：`mergeMeta(remote, local)` 原本只合并 `ingChecked`、`cooked` 和较新的 `cooked_at`。当两端同一菜谱都有 `cooked_history`、`cookedHistory`、`cooked_log`、`cookedLog` 或 `cooked_dates` 数组时，后写入侧会覆盖先写入侧，导致统计历史丢失。

修复：在 `app/app.js` 的 meta 合并中，对上述做饭历史数组逐字段去重并集；保留既有 `cooked_at` 取较新逻辑。`test/frontend.test.mjs` 扩展了 `mergeUserDataConflict` 用例，覆盖远端和本地各自拥有做饭历史及日期型老记录的合并结果。

## README 双语核对

中文 README 与英文 README 对最终功能描述基本一致：视频/文字/图片导入、视觉 OCR、步骤图/食材图、双端 PWA/APK、AI 变体、菜谱集、库存、工具清单、购物与计划、统计、分享图卡、Intl 本地化、schema.org/Cooklang 互通和自托管能力均有对应实现或测试。英文 README 对作者私有部署段落明确说明不作为通用部署指南，未造成用户可操作能力的误导。

唯一需要注意的边界是：`PAODING_OUTPUT_LANG=en` 是对 LLM 输出语言的 prompt 约束，README 也使用“ask the LLM”语义；这不是强保证，取决于模型遵循程度。

## 验证

- `git log origin/main..improvements-2026-07`：最新链路包含 `c8f3399`、`96bedf9`、第 15 批修复、第 14 批交叉审查修复、第 12 批三项修复。
- `git diff origin/main..improvements-2026-07`：最终差异覆盖 79 个文件，约 12.4k 行新增。
- 临时 worktree 跑最新 `improvements-2026-07`：`npm test` 155/155 通过。
- 当前修复分支：`node --test test/frontend.test.mjs` 50/50 通过；`npm test` 145/145 通过。

