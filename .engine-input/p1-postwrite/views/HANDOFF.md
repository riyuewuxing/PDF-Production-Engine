# HANDOFF — 求职达人（qiuzhidaren）接手首页

> 本文件是**唯一接手首页**：读这一页即可开工。规则细节一律指向「下一跳」，不要在本文件堆规则。
>
> 状态：**P0 CLOSED / P1 ACTIVE**。P1 将把其中执行进度与下一步改为由既有 execution ledger 事实派生；在 P1 完成前仍为兼容手工入口。
>
> as_of: 2026-09-11

---

## 1) 一句话现状

- **项目**：面向多职业、多求职阶段的结构化求职业务与 Artifact 项目；**当前第一职业方向 = 教师**。
- **两个仓库**（边界是硬约束）：
  - 本仓 `riyuewuxing/qiuzhidaren`（**私有**）：业务内容、规则、工具、验收 receipt。
  - 构建引擎 `riyuewuxing/PDF-Production-Engine`（**公开**）：无状态机械执行，负责 PDF 构建/预检/全页渲染。
  - 两仓**没有直接仓库关系**：不 checkout、不持对方 PAT、不写回；正常执行是**会话中介的临时执行**（ChatGPT/session-mediated ephemeral）。
- **教师板块 lifecycle 以 `production/contracts/module-registry-v1.yaml` 为唯一 authority**：
  1. 试讲 teaching-demo —— **ACTIVE**，本轮首个端到端集成对象，固定交付 2 份 PDF
  2. 结构化面试 structured —— **FROZEN**
  3. 答辩 defense —— **FROZEN**
  4. 自我介绍 self-introduction —— **FROZEN**
  5. 简历与报名材料 resume-materials —— **DEFERRED**
  6. 笔试 written-exam —— **DEFERRED**
  7. 岗位情报 position-research —— **RETIRED**；只消费外部 Recruitment Intelligence 的 `Validated Opportunity Package`
- **当前工作**：架构整改 P0–P4，计划全文见 `docs/target-architecture-v1.md` §6。

---

## 2) 现在该干什么（唯一下一步）

**当前阶段：P1 — execution-state derivation（ACTIVE）**

已确认：
- `main` 是私库唯一分支与当前 authority；
- `AGENTS.md` 已采用 HANDOFF-first；
- `docs/READING-PATH.md`、`docs/target-architecture-v1.md`、`docs/ARCHITECTURE-EXECUTION-PLAN.md` 已入库；
- `contracts/engine-handoff.yaml` **已经存在**，但 engine commit / schema hash 仍是占位，因此“合同存在”不等于“锚定完成”。

**唯一下一步：实现 P1 确定性状态投影。** 不新建第二套 `state/events`；复用现有 `production/contracts/execution-ledger-v1.yaml`、真实 ledger/operator 与七阶段生命周期，产出兼容的 CURRENT_STATE 执行视图、NEXT_ACTION、CATALOG 与 HANDOFF 投影。

P0 已关闭。后续：**P1 当前进行中** → P2 引擎锚定/打包/Golden Path + P3 交付/资格解耦（两者共同形成第一份可用交付）→ P4 门禁收敛。

---

## 3) 边界（能改 / 不能改）

- **可改**：通用实现、输入块、模板、模块合同里的数字。
- **不可改**：全局状态机阶段名、阻塞三态枚举、跨仓锚点契约、门禁的否决权。
- **禁止**：
  - 删断言/放宽检查以求「全绿」；
  - 为单个课题、学校、`case_id` 写长期特判；
  - 把私有内容（教材、个人材料、候选人事实）提交到**公开**引擎仓；
  - 在没有删除能力的情况下执行「清理」（上一个 AI 因此留下 13 条空壳分支）。

---

## 4) 在哪构建 / 怎么验收

- **构建在引擎仓**，不在本仓。`contracts/engine-handoff.yaml` 已作为唯一跨仓合同入库；P2 要做的是验证候选、正常集成引擎 main、打稳定 tag，并回填/校验 engine `commit` 与 schema hash。**禁止依赖会话记忆**。
- **当前构建阻塞**：
  - `engine-handoff.yaml` 合同已存在，但 `engine.commit` / `cli_contract_sha256` 尚未回填，稳定 tag 尚未形成可验证闭环；
  - 引擎仓 `main` 当前仍是 bootstrap 占位实现，真实能力分散在候选分支；必须先比较真实 schema/workflow/fixture/CI，再以正常 fast-forward/merge/PR 集成 main，**禁止 force，禁止先删分支**。
- **验收**：机器门禁 → **人工逐页**查看最终 PDF。机器通过 ≠ 视觉通过；引擎最多只能报 `MACHINE_PASS + REVIEW_REQUIRED`。

---

## 5) 阻塞（三态，禁止静默）

| 项 | 状态 | 原因 | 解锁条件 |
|---|---|---|---|
| 正式试讲 PDF 交付 | **BLOCKED** | 架构把 `formal_pdf` 与资格线耦合，交付门被锁 | 完成 P3「交付/资格解耦」 |
| 跨仓构建 | **BLOCKED** | 跨仓合同已存在但 commit/schema hash 未绑定；引擎 `main` 尚未承载经验证实现 | 完成 P2a：验证候选→正常集成 main→稳定 tag→回填并严格校验锚点 |
| 状态派生 | **DEGRADED** | 通用实现已在公开引擎 py_compile + 异构/负例 8/8 PASS；当前私库 6 个 ledger 的 committed view 已 bootstrap，但实际仓 checker 尚未执行 | 对当前 committed views 跑 `derive_state` / `gen_handoff` / `check_state_derivation`，一致后关闭 P1 |
| 逐讲稿内容线当前状态 | 见 `production/process/teaching-demo-content/STATUS.yaml` | 该系统文件记录 `ROUND2_REJECTED_PROCESS_NOT_CALIBRATED` | 随 P3 解耦后重新对齐 |

> 三态语义：`BLOCKED` 上游/外部条件不满足，只能输出解锁条件；`DEGRADED` 部分证据缺失但可继续，须显式标注；`NOT_EXECUTED` 该环节从未执行，**严禁写成通过**。

---

## 6) 下一跳（最小必读集）

按序读 5 份即可开工 —— 详见 `docs/READING-PATH.md`：

1. `docs/READING-PATH.md`
2. `CURRENT_STATE.yaml`
3. `docs/target-architecture-v1.md`
4. 目标模块的 `AGENTS.md` 及 `production/contracts/` 下对应合同
5. `production/process/teaching-demo-content/STATUS.yaml`（做试讲时）

> `architecture/adr/ADR-001…017` 仍是 **ACCEPTED 架构决策且不可原地改写**，但**不是逐份通读的开工前置**——遇到架构争议时按需查阅。

---

## 7) 已知的历史教训（不要重犯）

1. **对抗性加固棘轮**：靠「新 ADR supersede 旧 ADR」单向加锁，把「防绕过」演化成「防交付」。新增门禁必须**净不增**。
2. **跨仓锚点沉入会话记忆**：边界只写在声明里、不钉死 ref/commit → 换一个 AI 就断。锚点必须写进仓库且机器可校验。
3. **状态自述且漂移**：执行进度、下一步与 current 产物指针必须由既有 execution ledger 事实派生；模块注册、架构策略等规范事实仍由各自 authority 维护。
4. **没有执行面却标完成**：新增通过类执行断言必须绑定真实执行面和可核验证据；历史缺 instrumentation 的事实保持 `UNKNOWN_MISSING_INSTRUMENTATION`，禁止补造。
5. **无删除能力的清理**：只能「清空」不能「删除」→ 留下残骸。清理前必须确认执行者具备删除能力，否则不做。

---

<!-- GENERATED:ARTIFACT-EXECUTION START -->

## Generated Artifact execution snapshot

- as_of (latest ledger fact): `2026-09-04T08:21:47.614949Z`
- discovered Artifact Jobs: **6**
- lifecycle inventory: `BLOCKS_ACCEPTED=5, PUBLISHED=1`
- execution instrumentation: `UNKNOWN_MISSING_INSTRUMENTATION=6`
- canonical current Artifact Job: **none**
- selection policy: `explicit-job-id-only`
- anti-regression rule: historical/incomplete jobs are inventory only; never infer one as the current project task.

<!-- GENERATED:ARTIFACT-EXECUTION END -->
