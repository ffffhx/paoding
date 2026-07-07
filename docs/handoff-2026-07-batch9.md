# 交接文档（第九批）：工具/器具清单，甜品重点（2026-07）

> 用户新需求原话：「如果涉及到甜品的话，这道菜需要告诉我需要什么工具。比如说是需要打发器、裱花袋，还是抹刀这种做甜品用的工具，你需要说清楚。同样的，如果有替代品的话，也可以说；没有替代品的话，也请说明清楚。」
> 按 I1 → I4 顺序，**每项 `npm test` 全绿后单独 commit**（gpg 用 `-c commit.gpgsign=false`）。**绝对不要 git push**。

## 项目约束（不变）

零第三方运行时依赖；`node --test`（用 E1 stub 基建）；新增 UI 字符串必须走 `app/i18n.js` 的 `t()`（zh+en 同步）；README 双语同步；诚实原则。

---

## I1：菜谱 schema 增加 `tools` 字段（引擎层）

1. `structureRecipe`（src/chef.mjs）的输出 schema 增加：
   ```
   tools: [{
     name,            // 工具名，如 "电动打蛋器"
     purpose,         // 干什么用，如 "打发蛋白到硬性发泡"
     essential,       // bool：缺了做不了 or 只是方便
     substitute,      // 替代方案字符串；【无替代时必须为 null】
     substitute_note, // 有替代：替代的代价/注意点；无替代：为什么替不了（一句话）
     inferred         // bool：视频没明说、按工艺推断的标 true
   }]
   ```
2. Prompt 规则：
   - **甜品/烘焙类**（蛋糕/饼干/慕斯/塔派/面包/裱花/巧克力/糖艺等，让 LLM 按菜品判断）：工具清单**必须完整**——打发器/打蛋器、裱花袋+裱花嘴、抹刀/刮刀、模具（注明尺寸如视频有提）、油纸、厨房秤、温度计、烤箱等，逐个给 substitute 或明确 null+原因（例：裱花袋→保鲜袋剪角可凑合；电动打蛋器打发蛋白→手动极耗时但可行；戚风模具的防粘涂层版→无替代，会爬不起来）。
   - **非甜品**：只列非常规厨具（蒸锅/砂锅/烤箱/温度计），家家都有的锅碗瓢盆不要列。
   - 诚实原则延伸：视频画面/口播出现过的工具照实提取；没出现但该工艺必需的按常识推断并 `inferred: true`；**拿不准的宁可不列**。
3. 防御式清洗（照 chef.mjs 现有风格）：tools 非数组丢弃、缺 name 的条目丢弃、substitute 空串归一为 null。
4. 测试：E1 的 LLM stub 返回带 tools 的菜谱 → 断言字段落库与清洗逻辑（含脏数据 case）。

## I2：前端展示（App 层）

1. 菜谱详情页食材区之后加「🔧 需要的工具」卡片：每个工具一行——名称 + 用途；`essential` 标「必需」；`substitute` 有值显示「可替代：…」+ note；**null 显示醒目的「无替代」标记 + 原因**；`inferred` 标「推断」小字。没有 tools 字段的老菜谱不显示卡片。
2. 跟做模式：某步骤文本命中工具名时，在该步下方小字提示本步用到的工具（复用食材高亮的匹配思路，纯函数）。
3. 老菜谱补齐：详情页对无 tools 的菜谱提供「AI 补工具清单」按钮（照「AI 补讲解」的模式：走鉴权+限流，LLM 按食材+步骤推断，全部标 inferred，写回菜谱 JSON）。
4. 编辑器支持 tools 的增删改（照 D2 食材编辑的模式）。
5. 所有新文案进 i18n 字典（zh+en）。
6. 测试：渲染/匹配纯函数 + AI 补工具端点（LLM stub）。

## I3：导出与打印

1. schema.org JSON-LD：Recipe 继承自 HowTo，直接用标准 `tool` 属性输出（HowToTool 对象数组，name + requiredQuantity 不需要，description 放 purpose/替代信息）。
2. Markdown 导出与打印视图（G2）加「需要的工具」小节。
3. JSON-LD 导入（C3）反向兼容：外部 Recipe 带 `tool` 的映射进 tools（substitute 留 null、inferred false）。
4. 测试：导出含 tool、导入映射。

## I4：收尾

1. 自查本批 diff（新端点限流/鉴权、tools 清洗边界、i18n 无漏网中文）。
2. README（双语）功能表加工具清单说明，Roadmap 更新。
3. 最终 `npm test` 全绿、工作区干净、未 push、输出中文总结。

---

## 验收清单

- [ ] I1–I4 独立 commit，全绿
- [ ] 甜品工具：有替代给替代+代价，无替代明确标注+原因，推断的标 inferred
- [ ] 新 UI 文案全部走 t()（zh/en），老菜谱无 tools 不报错
- [ ] JSON-LD 导出/导入用标准 HowTo tool 属性
- [ ] 未引入 npm 运行时依赖；未 push
