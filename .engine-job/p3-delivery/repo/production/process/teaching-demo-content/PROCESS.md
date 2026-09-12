# Teaching Demo Content｜唯一生产线

本目录只负责 **训练参考教案 / 考场骨架 / 逐字稿 / 课题专属答辩 / 教材到骨架提炼解析** 的内容形成与内容验收。

本文件是该功能块唯一 PROCESS authority，只从 GitHub `main` 最新 HEAD 读取。唯一合同是 `production/contracts/teaching-demo-content.yaml`，唯一完整 readiness / acceptance composition 与唯一受支持 CLI 是：

`tools/check_teaching_demo_content.py#validate`

内部实现：

- `tools/_teaching_demo_content_core.inc`：仅保留 mature deterministic primitives；**物理不存在 `validate/main` aggregate/CLI symbol**；
- `tools/teaching_demo_content_architecture.py`：library-only primitive facade；不再使用 caller/stack/path/name metadata 做 aggregate isolation；
- `tools/_teaching_demo_content_architecture_impl.py`：pure deterministic architecture primitives；
- `tools/teaching_demo_content_enforcement.py`：Executable Enforcement Registry、canonical MACHINE_GATE receipt generator、Gate A adversarial primitives；**不存在 aggregate `validate_case`**。

以上内部文件均无独立 gate、无独立 lifecycle、无 acceptance authority。**单一 authority 由 capability removal + composition locality 强制，不靠“unsupported”、caller 身份、stack/path/function-name/code-object/closure guard。** 若 helper 直接调用会构成第二个 acceptance-like capability，就必须拆成 primitive 或删除，而不是尝试识别谁在调用。

禁止创建日期版、v2/v3、legacy、backup、experimental、compatibility、branch-specific 第二条内容线。下游 Artifact/PDF/Engine/机器 PDF QA/全页 HUMAN review 不属于本流程；内容未独立接受前不得启动。

---

## 1. 当前架构决策、两次独立 Gate A REJECT 与 RRA4 修正

Teaching Demo Content 的 compiler/state-machine 主架构由 `ADR-012-evidence-carrying-teaching-script-compiler.md` 定义；ADR-013 保留 Phase-A accepted global lock、repository-local Gate-B self-activation 禁令与 semantic-judge producer provenance 边界。2026-09-09 独立 Gate A 证明 ADR-013 的“metadata deny-only 可保护 historical aggregate”局部假设仍不足，因此新增 ACCEPTED `ADR-014-teaching-demo-capability-removal-and-first-full-exposure.md`，**只 supersede ADR-013 的该局部假设，不原地改写 ADR-013 历史。**

```text
repository-materialized exact textbook source
→ machine source identity lock
→ independent HUMAN SOURCE_REVIEW
→ verified reference evidence + structural candidate comparison
→ Lesson Evidence IR
→ Typed Script Event Stream
→ five natural-language user products
→ machine-derived SCRIPT_FACTS v2 / release claims
→ Executable Deterministic Gate + MACHINE_GATE receipt
→ Science / Evidence Judge verifies every knowledge-release claim
→ machine derives verified_first_release
→ Board causality + answer-resource first-full-exposure causality
→ Enactment / Student Judge
→ Submission Freeze
→ Independent HUMAN Review
→ post-freeze HUMAN_ACCEPTANCE_RECEIPT
→ protected downstream eligible
```

核心原则：**Agent autonomy at the edges; deterministic workflow at the center.** 模型负责学科判断和自然语言创作；actual facts、状态迁移、硬约束、证据绑定和提交资格不得交给作者自觉。

第一次独立 Gate A 在 `main@89d75bed...` 发现：

1. **GATEA-P0-01**：internal core 仍能形成较弱 aggregate gate；
2. **GATEA-P1-02**：作者可用 hidden `event.releases:[K1]` 自签“知识已形成”。

RRA3 又处理了 caller spoof、mutable checker authority 与 Gate-B self activation，但第二次独立 Gate A 在 `main@060a774...` 继续 REJECT，证明两个更底层问题：

1. **GATEA-RRA3-P0-04 / capability isolation 仍未成立**：decorator-wrapped checker stage collector 的 closure 可恢复 raw undecorated aggregate；architecture facade 的 deny-only core guard 又依赖 canonical `co_filename + function name`，同源代码换 alternate `co_filename` 即可绕开识别。结论：**metadata/closure guard 本身不是 capability isolation。**
2. **GATEA-RRA3-P1-05 / split-validator full exposure bypass**：`safe show → STUDENT_RESPONSE → RESOURCE_SHOW FULL → later formation → later compliant RESOURCE_REVEAL` 可利用 visibility validator 与 verified-formation validator 的观察面不一致提前泄露答案。

RRA4 因此不再“修 guard”，而是改变结构：

- core `validate/main` 物理删除；
- enforcement aggregate `validate_case` 物理删除；
- checker `_run_core_primitives / _validate_freeze_review_acceptance` 与 guard/closure machinery 物理删除；
- 完整编排直接内联在唯一 `check_teaching_demo_content.py#validate`；
- caller/stack/path/name/code-object/closure metadata 不再承担 capability isolation；
- answer-bearing discovery/scaffold 的任何 `RESOURCE_SHOW visibility: FULL` 一律拒绝；
- 机器跨所有 resource events 派生 `first_full_exposure`，其 event type 必须是 `RESOURCE_REVEAL`，并满足 `verified_first_release.ordinal < first_full_exposure.ordinal`。

Phase-A accepted mode仍全局 fail-closed。Semantic judge payload 在 Phase A 可检查 binding/verdict/evidence integrity，但 producer independence 仍属于 Phase-B controller/runtime provenance；RRA4 不伪称解决了这一尚未实施的 capability。

---

## 2. Authority / Refresh Loop

每次继续、修改、生成、修复前必须重新读取最新 `main`，至少按以下顺序：根 `AGENTS.md` → `CURRENT_STATE.yaml` → architecture README/ADR-009/ADR-012/ADR-013/ADR-014 → module registry → `PROJECT_MEMORY_RULES.md` → Teaching Demo 局部 AGENTS → 本 workstream MEMORY/STATUS/PLAN/RECORDS → 本 PROCESS → 唯一 contract → canonical checker 及 internal core/facade/impl/enforcement → 当前真实修改文件。

Library/handoff/聊天记忆均不是 runtime authority。若冲突，以 GitHub `main` 当前真实字节为准。每个 substantive write 后必须重新 resolve 最新 HEAD，不能拿写入前 SHA 继续做最终断言。

---

## 3. 不可越界历史

Round 1 / Round 2 首次冻结包、首次评分和 REJECT 是 immutable historical evidence。不得修改历史首次包刷分、把 readiness/engineering PASS 改成 HUMAN PASS、自动抽第三题、恢复旧 Teaching Demo route、Gate A/B 未完成时抽 fresh topic，或 content independent acceptance 前启动 PDF/Artifact/Engine。

历史事实保持：Round 1 加速度 85 / 法拉第 83，均 REJECT；Round 2《电场强度》77/hard fail 2/REJECT，《动量定理》87/hard fail 0/REJECT；process=`NOT_CALIBRATED`。

---

## 4. Requirement → Executable Enforcement → Evidence → Gate

所有 HARD requirement 只从唯一 contract `requirement_registry` 读取。每项必须有 `requirement_id / severity / authority_source / subject / enforcement_class / enforcer / evidence_required / failure_code / gate_effect / historical_probe`。

固定 class：`MACHINE_DETERMINISTIC / SEMANTIC_JUDGE / HUMAN_ONLY / AUTHOR_SELF_CHECK`。

### 4.1 文档登记不等于 enforcement

每个 `MACHINE_DETERMINISTIC + HARD` REQ 必须在 `tools/teaching_demo_content_enforcement.py#ENFORCEMENT_SPECS` 恰有一个：

```yaml
REQ-ID:
  validator_id:
  failure_code:
  probe_id:
  stage:
  runner: local:<callable> | core:<primitive> | checker:<callable>
```

contract failure code 必须与 spec 一致；runner 必须解析到真实 callable；missing/orphan spec fail。MACHINE_GATE 只覆盖 stage≤MACHINE_GATED 的 MACHINE/HARD requirement，每项保存 `requirement_id / PASS / validator_id / failure_code / probe_id / runner`，并绑定 registry digest + state-trace-prefix digest。duplicate/missing/extra/stale metadata 均 fail。

### 4.2 P0｜唯一完整编排必须靠 capability removal 证明

唯一完整 decision composition 是 `tools/check_teaching_demo_content.py#validate`。以下结构要求是 HARD：

- `_teaching_demo_content_core.inc` 中 `validate` 与 `main` **symbol 必须不存在**；
- enforcement 中 aggregate `validate_case` **symbol 必须不存在**；
- checker 中历史 `_run_core_primitives`、`_validate_freeze_review_acceptance`、`_guard_stage_collector`、`_canonical_validate_context_allowed`、`_make_canonical_context_guard` **必须不存在**；
- canonical `validate` 不得通过 closure 保存可恢复的 raw stage aggregate；
- complete readiness/freeze/accepted composition 直接位于 canonical `validate`；helper 只允许 primitive semantics。

永久 adversarial regressions 改为“证明 absence”，而不是“证明 guard 暂时挡住”：

1. inspect loaded core：无 `validate/main`；
2. 读取 exact internal-core source，用攻击者指定 alternate `co_filename` compile/exec：scope 仍无 `validate/main`；
3. enforcement 无 `validate_case`；
4. checker 无上述 stage collector/guard symbols；
5. canonical `validate.__closure__ is None`，不存在可 unwrap 的 hidden stage aggregate。

**禁止**再次引入 caller/stack/path/module/name/code-object/closure metadata 作为 acceptance capability isolation。ADR-013 的旧 deny-only premise 已被 ADR-014 supersede。

### 4.3 作者自查永远不能升级

`science_red_team / student_state_simulation / enactment_board_dry_run / cycle_enactment_audit / information_release_audit` 只可做风险提示；author PASS 不得解锁 machine/semantic/HUMAN gate。

---

## 5. Source / Task / Reference Review

先核题面、教材版本、真实教材页、图/实验/数据、条件、边界、考试要求，禁止 fabricate measurement/data。科学事实优先级：当前题面与真实教材 > 已核官方/用户来源 > 已核参考机制 > 一般知识。

### 5.1 Exact Source Lock｜MACHINE

`SOURCE_LOCKED` 前正式来源只接受 `repository-pdf`，记录 repository-relative file、size、Git blob SHA-1、SHA-256、PDF/printed page mapping、audit locator；canonical checker 从 bytes 重算。`remote-pdf` 只能做 ingest，必须先 materialize 到 canonical textbook store。

### 5.2 SOURCE_REVIEW｜HUMAN_ONLY

`REQ-SRC-ID-001` 证明“哪一份 bytes”；`REQ-SRC-REV-001` 证明独立 reviewer 实际打开 selected pages。唯一 `SOURCE_REVIEW.yaml` 必须 exact-bind source identity/page mapping。机器只验证 receipt/binding integrity，不冒充视觉审阅者。role/separation 字段是 workflow declaration，不是密码学身份凭证；controller/reviewer workflow 必须真实满足职责分离。

### 5.3 Reference Structural Fingerprint

每题在 `evidence.yaml#reference_learning.structural_candidate_comparison` 比较至少 2 个不同 current CASE，推荐 3 个。每候选必须有 canonical `CASE.yaml` 路径、当前 `case_receipt_sha256`、机制/证据/形成/任务/资源/误区/推理/课堂结构。机器重算当前 CASE SHA，假路径、重复、stale SHA fail；semantic/HUMAN 判断结构匹配质量。

---

## 6. Lesson Evidence IR

`LESSON_EVIDENCE_IR.yaml` 是 planned facts，不是 actual facts。每个 knowledge unit 至少包含 claim/strength/source evidence/prior knowledge/visible evidence/resource state/student task/permissible response/future-info guard/scaffold boundary/formation claim/board/practice links。

formation claim 不能强于 actual visible evidence + prior knowledge + permitted scaffold；independent transfer 不得提前得到关键答案。Round2《电场强度》永久 probe：只有“q 变、F 也变”不能形成“F/q 稳定”。

---

## 7. Typed Script Event Stream + Verified Knowledge Release

`SCRIPT_EVENTS.yaml` 是实际课堂执行结构；用户最终只看到自然中文，event/REQ ID 禁止泄漏。

事件类型：`SPEAK / FORMULA_ORALIZE / ASK / INVITE / WAIT / STUDENT_RESPONSE / PARAPHRASE / FEEDBACK / SCAFFOLD / RESOURCE_SHOW / RESOURCE_HIDE_OR_MASK / RESOURCE_REVEAL / BOARD_ADD / PRACTICE / TRANSITION / CLOSE`。

普通 event 至少有 `event_id / type / cycle_id`。资源/板书/练习/公式分别绑定 resource_id/board_delta_id/practice_id/formula_id。

### 7.1 bare `releases` 不再是事实

旧字段 `releases` 在迁移期只能为空列表。**任何非空 bare `event.releases` 直接 machine fail**，不能再生成 `first_release`。

形成知识必须声明：

```yaml
release_claims:
  - knowledge_id: K1
    visible_span: "最终可见正文里真实出现、且在本 event text 中唯一匹配的形成语句"
```

机器只证明：knowledge id 完整/唯一、`visible_span` 在同一 event 的可见 `text` 中 exact unique match、所有 `formed_knowledge_ids` 恰好有一个 claim。机器**不证明**该句语义真的足以形成 K1。

### 7.2 Science/Evidence Judge 逐项验证 release claim

`SCIENCE_EVIDENCE_JUDGE.yaml` 除普通 verdicts 外必须有每个 claim 的 `release_verifications`：`knowledge_id / event_id / visible_span / PASS|FAIL|UNKNOWN / reason / confidence / event+exact-text evidence_refs`。FAIL/UNKNOWN 任一阻断；Science judge 还必须对 `REQ-REL-001` 给 blocking 全局 verdict 并覆盖所有 claim refs。

只有所有 release verification PASS 后，机器才在内存中导出：

`verified_first_release[knowledge_id] = {event_id, ordinal, visible_span, verification}`。

该 runtime view 不是作者可编辑 artifact，也不写回 SCRIPT_FACTS。

### 7.3 Gate A P1 永久负例

- **M20 / bare false release**：visible text 不变，早期偷偷写 `releases:[K1]`，随后提前 board/reveal → deterministic REJECT；
- **M21 / false visible-span claim**：span 真实存在但语义不足形成 K1 → semantic FAIL/UNKNOWN，verified release 不得产生。

---

## 8. 无生试讲 Interaction

回答型 `scaffolded_formation / independent_transfer / evaluation` 至少按 `ASK → INVITE → WAIT → STUDENT_RESPONSE → PARAPHRASE → FEEDBACK`。WAIT 要真实等待；response 必须当前可达；paraphrase 不得偷偷升级；feedback 必须有认知承接；教师提前给关键答案后不得声称 independent。

---

## 9. Resource Visibility + First-Full-Exposure Causality

answer-bearing `discovery/scaffold` 资源必须同时满足：

1. 有实际 `STUDENT_RESPONSE`；
2. 回答前必须真实 `RESOURCE_SHOW`，visibility 只能 `SAFE/MASKED/CROPPED`，且 show ordinal `< response ordinal`；
3. safe/masked/cropped show 不得携带 answer-bearing release claim；
4. **任何 ordinal 的 `RESOURCE_SHOW visibility: FULL` 一律 REJECT**，包括 response 之后；
5. FULL answer exposure 只能由 explicit `RESOURCE_REVEAL` 产生，且 reveal ordinal `> response ordinal`；
6. machine 必须跨**所有** resource events 派生 `first_full_exposure`：`RESOURCE_SHOW FULL` 与 `RESOURCE_REVEAL` 都是 full-exposure candidate；
7. 最早 candidate 的 event type 必须是 `RESOURCE_REVEAL`；
8. 对每个 answer-bearing knowledge：`verified_first_release.ordinal < first_full_exposure.ordinal`。

因此以下 RRA3-P1-05 mutant 必须双重 REJECT：

`SAFE/MASKED SHOW → STUDENT_RESPONSE → RESOURCE_SHOW FULL → verified formation → compliant RESOURCE_REVEAL`

visibility primitive 因 FULL SHOW 拒绝；verified-causality primitive也因 `first_full_exposure` 不是 `RESOURCE_REVEAL` / 早于 formation 拒绝。**后面的合规 reveal 不能洗掉此前已经发生的 full exposure。**

---

## 10. Board｜只消费 verified_first_release

actual board 只从 `BOARD_ADD` 累积，必须绑定 `BOARD_TIMELINE` delta，final board 等于 ordered actual adds。对每个 prerequisite/newly formed knowledge：`verified_first_release.ordinal < BOARD_ADD.ordinal` 必须严格成立。bare metadata、unverified claim、BOARD_ADD 自己同时形成知识都不能解锁板书。

---

## 11. Practice / Homework

`practice_inventory` 每个新 item 显式 `execution_scope: trial_event | support_product`。trial_event 必须 prompt_role=trial 且产生 ordered/unique/text-bound PRACTICE event；support_product 不进入试讲 event stream，但继续受 product prompt/answer anchors 约束。新包缺 scope machine fail；历史 Round1/2 不得为了迁移修改。

---

## 12. Timing / Formula Oralization

final spoken coverage=100%；spoken/wait 有正时间；resource/reveal/board action 有 action time；total elapsed 可复算；无 rehearsal 只能 ESTIMATE，MEASURED 必须绑 rehearsal。

公式样式文本若出现在非 FORMULA_ORALIZE event，machine fail；regex 无法确定的剩余情况由 `REQ-TIM-005` Enactment/Student Judge blocking 审查。

---

## 13. SCRIPT_FACTS v2

`SCRIPT_FACTS.yaml` 必须从 final events 重新派生并 exact-equal；作者不可自由编辑。v2 保存 cycle sequence、release_claims、resource shows/masks、board adds、practice events、formula oralizations、student responses、scaffolds、spoken ids/text digest、elapsed seconds、facts digest。**`first_release` 字段禁止**；hard causality只用 ephemeral `verified_first_release`。

---

## 14. State Machine + Durable Evidence

状态固定：`SOURCE_LOCKED → EVIDENCE_READY → IR_READY → SCRIPT_BUILT → SCRIPT_FACTS_DERIVED → MACHINE_GATED → SEMANTIC_JUDGED → SUBMISSION_FROZEN → HUMAN_ACCEPTED`。

`WORK_PACKET.yaml` terminal=`SUBMISSION_FROZEN`，保存从 SOURCE_LOCKED 起完整相邻 state_trace；transition evidence refs 只允许 current `source-lock:` 与 workspace `artifact:`，文件/摘要必须真实解析。HUMAN_ACCEPTED 不修改 frozen Work Packet，只由 post-freeze `HUMAN_ACCEPTANCE_RECEIPT.yaml` 记录。

---

## 15. MACHINE_GATE

`MACHINE_GATE.yaml` 绑定 current source commit、complete machine input closure、state-trace prefix digest、enforcement registry digest，以及每个 stage≤MACHINE_GATED 的 MACHINE/HARD REQ 的 `requirement_id/PASS/validator_id/failure_code/probe_id/runner`。

`REQ-REL-002` 属于 MACHINE_GATED 前结构 gate；`REQ-REL-001` 是 semantic；`REQ-BRD-002` 与 `REQ-RES-004` 依赖 semantic-verified release，lifecycle stage 在 SEMANTIC_JUDGED，不得提前出现在 MACHINE_GATE PASS coverage。

---

## 16. Complete Binding Closure

MACHINE_GATE 绑定 PROCESS/contract/checker/internal core/architecture facade+impl/enforcement、manifest/source lock/source PDF、SOURCE_REVIEW、reference contract与selected CASE、all deterministic sidecars、IR/events/facts、五份用户产品、BOARD_PLAN。Judge 再绑定 MACHINE_GATE；Freeze 再绑定 Work Packet + two judges。相关 byte 改变使旧 evidence stale。

---

## 17. Semantic Judges 与 producer provenance

Science/Evidence Judge 负责 evidence/observation-inference/claim strength/conditions/response reachability/resource inference，并独占 `REQ-REL-001` release semantic entailment；Enactment/Student Judge 负责 leakage/scaffold honesty/interaction function/enactment semantics/residual formula/timing-text correspondence。

普通 verdict 必须 `PASS|FAIL|UNKNOWN + claim + exact evidence_refs + reason + confidence`；blocking FAIL/UNKNOWN fail closed。

必须区分：Phase-A checker 可验证 **payload integrity/input binding**，但 `reviewer_role / separation bool / runner string / self digest` 不证明 **producer provenance**。后者必须由 Phase-B controller execution receipt 绑定 exact inputs、runtime/controller identity、actual output bytes与执行结果，并用 HUMAN Gold/known mutants 校准；独立 Gate B 必须攻击 fabricated role/runner/review/self-activation。

---

## 18. Submission Freeze

只有 blocking deterministic + semantic requirements 全部按 lifecycle 通过后才可 SUBMISSION_FROZEN。Freeze exact-bind manifest、PROCESS、contract、checker、internal core、facade+impl、enforcement、SOURCE_REVIEW、教材 bytes、sidecars、IR/events/facts、Work Packet、MACHINE_GATE、two judges、five products、board plan、reference contract/receipts。`source_commit == WORK_PACKET.main_sha`；任一 bound byte 改变则 stale。

Phase A freeze/readiness 不是 accepted/downstream authority。

---

## 19. Independent HUMAN、HUMAN_ACCEPTANCE_RECEIPT 与 Phase-A accepted lock

Independent HUMAN 对 exact frozen bytes 评分。PASS 要 total≥92、每维过线、hard fail=0、review exact-bind freeze。随后唯一 `HUMAN_ACCEPTANCE_RECEIPT.yaml` 记录 `SUBMISSION_FROZEN → HUMAN_ACCEPTED` 并 bind freeze + review；不得修改 frozen Work Packet。

但当前 Phase A 中 canonical `validate(require_independent=True)` 在 case-local final acceptance 之前全局 fail closed：无 activation file → `CONTENT_PHASE_B_CONTROLLER_NOT_IMPLEMENTED_PHASE_A_LOCK`；repo 自填 activation → `CONTENT_PHASE_B_REPOSITORY_SELF_ACTIVATION_FORBIDDEN`。只有 Phase B 实现并独立验证真实 controller/runtime provenance 后，才允许通过新的 reviewed code/contract change修改此 lock。

---

## 20. Phase B Eval Harness First

只有新的独立 Gate A PASS 后才进入 Phase B。永久 probes 至少包括：

- M20：nonempty bare `releases` + premature board/reveal；
- M21：结构合法但语义不足的 visible-span formation claim；
- **P0-RRA4-A**：loaded core 不存在 `validate/main`；
- **P0-RRA4-B**：exact core source 改 alternate `co_filename` compile/exec 后仍不存在 `validate/main`；
- **P0-RRA4-C**：enforcement 不存在 `validate_case`；
- **P0-RRA4-D**：checker 不存在旧 stage collector/guard symbols，canonical `validate` 无 recoverable closure；
- **P1-RRA4-E**：`SAFE SHOW → RESPONSE → FULL SHOW → formation → REVEAL` 必须被 visibility 与 first-full-exposure causality 双杀；
- P0-H：forged repository Gate-B activation 不得解锁 accepted；
- P1-PROV：semantic role/separation/runner strings 没有 controller provenance 不得成为 accepted authority。

P0/P1 known mutants 目标 100% killed；positive Gold 不得靠“一律 FAIL”误杀。Phase B 第一工作仍是 semantic-judge controller/runtime provenance + eval harness，不是 fresh topic。

---

## 21. Fresh Validation / PDF

即使 Gate A + Phase B + Gate B 均 PASS，也只进入 fresh-validation preparation；fresh two-topic 仍需明确授权。两个 fresh first-complete packages 都必须 independent HUMAN≥92、每维过线、hard fail=0 才能 CALIBRATED；任一失败不自动第三题。PDF/downstream 不得提前启动。

---

## 22. Close-out Loop

任何 substantive write 必须：read-back 当前 GitHub bytes；执行当前环境真正可执行的 syntax/selftest/machine gate，没 repo shell 就明确 `NOT_EXECUTED_NO_REPOSITORY_SHELL`；更新 PLAN/STATUS/MEMORY；RECORDS append-only；同步 ENGINEERING_REGRESSION/Gate-A handoff/session handoff；实现者不得自签 Gate A/B/HUMAN。

Static Git read-back/compare/reasoning 可以形成 implementer static rereview evidence，但**不能写成 runtime PASS**。GitHub Actions 的账户/配额级阻塞也不能冒充 test evidence。

---

## 23. 铁则｜写完必须重新独立复查

**项目实际写入完成 ≠ 本轮完成。** 每个 substantive implementation batch 必须执行 `MANDATORY_POST_WRITE_INDEPENDENT_REREVIEW`，从最新 main 重新零信任攻击。

RRA4 后复查至少必须重新攻击：

- core source/runtime namespace 是否真的没有 aggregate `validate/main`，包括 alternate `co_filename` compile；
- checker 是否真的没有 closure-unwrappable stage aggregate；
- enforcement 是否真的没有 aggregate `validate_case`；
- 是否还有任何新 helper 能组合 source→machine→semantic→freeze/acceptance 多阶段并返回可被误认成完整 PASS；
- caller/stack/path/module/name/code/closure metadata 是否已从 capability isolation 中彻底退出；
- accepted mode 是否仍无 repository-local data-only unlock；
- downstream prebuild 是否仍只能经过 `content_gate.validate(... require_independent=True)`；
- semantic payload integrity 与 producer provenance 是否被错误混为一谈；
- contract MACHINE/HARD ↔ ENFORCEMENT_SPECS 是否 exact coverage；
- `RESOURCE_SHOW FULL` 是否对 answer-bearing discovery/scaffold 在**任何 ordinal**都 REJECT；
- first_full_exposure 是否横跨 FULL SHOW + REVEAL 计算，且必须是 REVEAL；
- verified formation 是否严格早于 first full exposure；
- exact P1-05 mutant 是否双重 fail closed；
- bare releases、SCRIPT_FACTS v2、release semantic verification、board causality是否仍保持；
- old mature core 被 supersede 的 diagnostics 是否只有明确范围，其余 F1–F6 protections 未丢；
- stale bindings、Round1/2 frozen evidence、PDF/downstream 边界；
- ADR-014/contract/PROCESS/STATUS/PLAN/MEMORY/RECORDS/ENGINEERING_REGRESSION/GATE_A_HANDOFF 是否与 latest main 一致。

发现任一 P0/P1 → 自动回 Phase A 原地修，修完再次 re-review。只有没有新的 blocking finding，才能刷新同一路径 Gate A handoff 并停在新的独立 Gate A 边界。实现者 re-review 永远不能替代独立 Gate A。
