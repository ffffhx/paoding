# 交接文档（第五批）：管线测试基建 + 性能 + 数据安全（2026-07）

> 前置：前四批已全部完成（见 git log）。本批继续同一分支。
> 按 E1 → E4 顺序，**每项 `npm test` 全绿后单独 commit**（中文 message 带前缀，gpg 用 `-c commit.gpgsign=false`）。**绝对不要 git push**。

## 项目约束（不变）

零第三方运行时依赖；`node --test`；简体中文；README/.env.example 同步；新端点走鉴权+限流。

## 背景

工程评估结论：解析管线（download → transcribe → LLM → 落盘）是全项目最重、最容易坏的链路，但因依赖真实 yt-dlp/ffmpeg/whisper/LLM 而几乎没有测试——每次改动都靠人工手测。本批给它建可离线运行的测试基建，这是所有后续迭代的信心地基。

---

## E1：管线集成测试基建（本批核心，值得花最多精力）

**思路**：不碰真实二进制和真实 LLM，全部用 stub 替身，让 `processVideo`/`processText` 能在 CI 里端到端跑通。

**要做**：
1. **二进制可注入**：检查 `src/download.mjs`/`transcribe.mjs`/`vision.mjs` 里 yt-dlp/ffmpeg/whisper-cli 的调用路径。若是硬编码命令名，则加环境变量覆盖（`PAODING_YTDLP_BIN`、`PAODING_FFMPEG_BIN`、`PAODING_WHISPER_BIN`，默认值不变），同步 `.env.example`。
2. **stub 脚本**：`test/fixtures/bin/` 放可执行 Node 脚本充当伪 yt-dlp（按参数输出伪音频文件与 `-j` 元数据 JSON）、伪 ffmpeg（拷贝/生成占位文件）、伪 whisper-cli（输出固定转写 JSON/文本，格式与真实输出一致——先读真实调用处解析的格式再造数据）。跨平台可执行：用 `node xxx.mjs` 形式调用或 chmod +x（CI 是 ubuntu，本机 mac，都要能跑）。
3. **LLM stub**：测试里起本地 http server 模拟 OpenAI 兼容接口（`/chat/completions`），按请求内容返回固定结构化菜谱 JSON / 讲解 JSON；`PAODING_LLM_BASE_URL` 指向它（确认现有配置变量名，按实际为准）。
4. **端到端用例**（`test/pipeline.test.mjs`）：
   - 本地视频文件 → 完整跑通 processVideo → 产出菜谱 JSON 断言字段完整（含步骤、why、source_time）
   - yt-dlp 失败 → processText 兜底路径正确触发（或按现有降级逻辑断言）
   - whisper 输出空 → 报错信息符合预期、临时目录被清理
   - LLM 第一次返回畸形 JSON → 重试后成功（stub 第一次回垃圾第二次回正常）
   - 断言临时目录清理（tmpdir 里无 paoding-* 残留）
5. 若个别路径实在难以 stub（如 vision 抽帧），说明原因并跳过，不硬凑。

## E2：菜谱列表索引缓存

**现状**：`GET /api/recipes` 每次全量 `readdirSync` + 逐个 `JSON.parse`，菜谱多了线性变慢。

**要做**：内存缓存列表摘要（id/标题/标签/时间/评分所需字段），按文件 mtime/增删失效（写入路径统一走一个使缓存失效的 helper：保存/删除/导入/解析完成）。行为不变，只提速。测试：改动菜谱后列表反映最新数据（现有 server 测试模式）。

## E3：自动备份

**现状**：只有手动导出。Yummly 关停、数据蒸发是这个品类用户最大的恐惧；本地部署同样怕误删/磁盘损坏。

**要做**：
1. 服务端定时任务（`setInterval`，默认每 24h，`PAODING_BACKUP_INTERVAL_H` 可调，0 关闭）：把 userdata（所有用户文件）+ 全部菜谱 JSON 打包成单个备份 JSON（复用现有导出格式），写入 `backups/paoding-backup-<ISO日期>.json`；保留最近 `PAODING_BACKUP_KEEP`（默认 7）份，超出删最旧。
2. 启动时若距上次备份超过间隔立即补一次。
3. `GET /api/backups` 列出现有备份（走鉴权）；恢复复用现有导入即可（README 说明）。
4. 打包/轮转纯函数配测试（目录注入临时路径）。

## E4：自查 + 收尾

1. 自查本批 diff：stub 注入不影响生产默认行为（不设环境变量时用原命令名）、缓存失效路径无遗漏（尤其导入/多用户写入）、备份定时器不阻塞退出（`unref()`）。
2. README：测试章节更新（管线测试怎么跑）、备份功能说明；Roadmap 更新。
3. 最终 `npm test` 全绿、工作区干净、未 push。

---

## 验收清单

- [ ] E1–E4 独立 commit，`npm test` 全绿（含新管线测试，CI ubuntu 可跑）
- [ ] 不设新环境变量时生产行为与之前完全一致
- [ ] 备份定时器 `unref()`，不影响测试进程退出
- [ ] 未引入 npm 运行时依赖；未 push
