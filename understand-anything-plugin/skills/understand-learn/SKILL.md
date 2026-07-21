---
name: understand-learn
description: Use when you want to interactively learn a codebase through a guided, stateful teaching flow — predicts, verifies, exercises, and resumes across sessions. NOT for: code generation, one-shot explanations (use /understand-chat), or learning non-code topics.
argument-hint: ["[--mode overview|feature|file <path>] [--goal <text>] [--continue|--status|--reset]"]
---

# /understand-learn

Interactively learn this codebase through a guided, stateful teaching flow. Unlike `/understand-onboard` (one-shot static guide) or `/understand-chat` (Q&A), this skill acts as a **code tutor**: it builds a project map, selects a real feature path, teaches one file at a time through a predict–verify loop, generates exercises, reviews your diffs, and persists progress across sessions.

> **Prerequisite:** Run `/understand` first to build the knowledge graph. This skill reads `$UA_DIR/knowledge-graph.json` — without it, there is nothing to teach from.

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains
5. **Always read real source code** when teaching a specific file — never rely on graph summaries alone for implementation details

## Options

`$ARGUMENTS` may contain:

- `--mode overview` — Produce a high-level project map, do not enter a feature
- `--mode feature` — (default) Select or specify a feature path and learn it file-by-file
- `--mode file <path>` — Learn a single specific file
- `--goal <text>` — Describe the feature you want to learn (e.g. `--goal "理解认证流程"`)
- `--continue` — Resume the current session from where you left off
- `--status` — Show current learning progress
- `--reset` — Clear learning state (does NOT delete the knowledge graph)

**Priority:** `--reset` > `--status` > `--continue` > explicit `--mode` > default `feature`.

## Phase 0 — Pre-flight

Run these three commands in order. They replace ~90 lines of bash parsing that used to live here — all path resolution, argument parsing, and freshness checking is now deterministic in the state script.

The state script lives alongside this SKILL.md. The LLM resolves `$SKILL_DIR` from its own context (it is reading this file).

```bash
# Define once, use everywhere below
STATE_SCRIPT="$SKILL_DIR/scripts/learning-state.mjs"
```

```bash
# 1. Resolve all paths + output language
node "$STATE_SCRIPT" "$PROJECT_ROOT" resolve
```

From the JSON output, extract `uaDir`, `graphExists`, `outputLanguage`. If `graphExists` is false, stop and tell the user to run `/understand` first.

```bash
# 2. Parse $ARGUMENTS into structured mode/goal/filePath
node "$STATE_SCRIPT" "$PROJECT_ROOT" parse-args "$ARGUMENTS"
```

From the JSON output, extract `mode`, `goal`, `filePath`. Mode priority is already applied by the script: `--reset` > `--status` > `--continue` > explicit `--mode` > default `feature`.

```bash
# 3. Check graph freshness vs HEAD
node "$STATE_SCRIPT" "$PROJECT_ROOT" check-freshness
```

From the JSON output:
- If `stale` is true, **warn** that graph-derived context may omit changes and suggest `/understand` to refresh. Then continue (best-effort).
- If `warnings` contains "No gitCommitHash" or "not found", give a brief best-effort warning and continue.
- If `stale` is false, proceed silently.

**Output language:** Use `outputLanguage` from step 1, or infer from session language. Technical identifiers, code symbols, and file paths always stay in their original form.

---

## Mode: `--reset`

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" reset
```

Confirm learning state cleared. The knowledge graph is untouched.

---

## Mode: `--status`

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" status
```

Display the current session summary. If no session exists, suggest starting with `/understand-learn`.

---

## Mode: `--continue`

1. Read current state via `node "$STATE_SCRIPT" "$PROJECT_ROOT" status`.
2. If no session exists, tell the user and suggest starting fresh.
3. If the session's `projectRoot` does not match `PROJECT_ROOT`, warn and do not continue.
4. Resume from the stored `phase`:
   - `preflight` / `overview` → re-enter overview
   - `selecting_feature` → re-enter feature selection
   - `learning_path_ready` → begin first file
   - `predicting` / `verifying` / `checking_understanding` → resume current file
   - `exercise_ready` / `exercise_in_progress` → resume exercise
   - `reviewing_diff` → resume diff review
   - `completed` → offer to start a new session or review notes

---

## Mode: `--mode overview`

Build a high-level project map. **Do not enumerate functions, dump full nodes, or describe every directory.**

1. Read `project` metadata only.
2. Read `layers[]` for architecture.
3. Grep for entry-point nodes: tags `entry`, `entry-point`, `main`, `cli`, types `endpoint` + `route`.
4. Identify complexity hotspots (nodes with `complexity: "complex"`, cap at ~5).

Output exactly:

```text
## 项目概览
- 解决什么问题：
- 主要语言 / 框架：
- 程序主要入口：
- 架构层：（从 layers 列出）
- 最重要的数据流 / 控制流：
- 建议优先阅读的 5 个文件：
- 当前可以忽略的目录：
- 复杂度热点：
```

After output, update state:

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" update-phase overview
```

Then stop. Wait for the user to ask to continue.

---

## Mode: `--mode feature` (default)

### A. Feature selection

**With `--goal`:** Use Grep to search the knowledge graph for nodes matching the goal keywords (`name`, `tags`, `summary`). Identify entry points and trace `calls` / `imports` / `depends_on` edges to build a candidate path.

**Without `--goal`:** Recommend at most 3 representative feature paths. Prioritize:
- CLI command processing
- HTTP request handling
- Message receive + respond
- Configuration load + persistence
- Data import / process / output
- Background task / queue
- Authentication / authorization

For each candidate, give:
- 链路名称
- 学习价值
- 入口节点
- 最终副作用
- 预计涉及的关键文件数量

Wait for the user to choose.

### B. Build learning path

Once a feature is chosen, trace the call/dependency graph to produce ~3–7 key files (aim for 5). Order:

1. Entry point
2. Orchestration layer
3. Core business logic
4. Infrastructure / persistence
5. Tests

For each file, briefly state:
- 为什么需要读
- 在链路中的位置
- 输入 / 输出
- 上游 / 下游
- 可以暂时忽略的细节

Save the path to state:

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" update-phase learning_path_ready '{"learningPath": [...]}'
```

Where each entry is `{ "filePath": "...", "nodeId": "file:...", "role": "...", "status": "pending" }`. Mark the first entry `"current"`.

Stop. Wait for the user to confirm before teaching the first file.

---

## Mode: `--mode file <path>`

1. Grep the knowledge graph for the file node (`filePath` match).
2. If not found, suggest the closest matching node by path similarity.
3. Find its `layer`, incoming edges, and outgoing edges.
4. Read the real source code.
5. Enter the **file learning loop** (see below) for this single file.

---

## File Learning Loop (one file per turn)

Teach exactly one file per interaction cycle. Do not advance until the user has answered.

### A. Establish context

Read:
- File node (summary, tags, complexity)
- Its layer
- Incoming edges (upstream callers/dependents)
- Outgoing edges (downstream dependencies)
- `contains` children (functions/classes defined here)
- Real source code

Output (keep short):

```text
文件：<filePath>
架构职责：<1-2 句，来自图谱>
在当前功能链路中的位置：
主要输入：
主要输出：
上游：<2-4 个关键节点>
下游：<2-4 个关键节点>
副作用：<状态变更、IO、全局影响>
暂时可以忽略：<实现细节、边界情况>
```

Distinguish clearly:
- **[图谱]** — architectural facts from the knowledge graph
- **[源码]** — facts confirmed from reading the source
- **[推断]** — your own inference (never state as fact)

### B. Prediction task

Ask the user to predict the implementation BEFORE revealing it:

> 在查看具体实现前，请预测这个文件完成任务时会经过哪些主要步骤。可以用 3～6 条简短步骤回答。

**STOP.** Do not continue until the user responds.

### C. Verify prediction

After the user answers:
1. Re-read the source if needed.
2. Map each predicted step to the actual implementation.
3. Mark each: ✓ 正确 / ~ 部分正确 / ✗ 错误 / ○ 遗漏.
4. For errors or omissions, explain why and cite specific functions/classes/lines.
5. Do NOT use humiliating or exam-like language. Be a tutor, not a judge.

### D. Understanding check

Ask exactly ONE question that tests:
- Data flow, control flow, state change, error path, dependency, or design tradeoff.

**Do NOT ask memory-only questions** like "这个函数叫什么".

**STOP.** Wait for the user's answer.

After they answer, provide brief feedback, then update state:

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" complete-file "<filePath>" "<nodeId>"
```

Advance to the next file. If all files complete, move to exercise generation.

---

## Exercise generation

After the learning path is complete, generate one small practice task.

Scope:
- ~1–3 key files
- No large architectural reframing
- Tests the user's understanding of the path
- Has clear acceptance criteria
- Uses the project's existing test framework where possible

Good tasks: add a CLI param, add boundary validation, improve an error message, add a structured log, add a test for an error path, add a small output format, add a configurable toggle.

Output format:

```text
目标：
背景：
允许修改的文件：
不应修改的部分：
必须保持的行为：
验收标准：
建议测试：
验证命令：
可能的风险：
```

Update state:

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" update-phase exercise_ready
```

**Do NOT implement the exercise for the user** unless they explicitly ask.

---

## Diff review (after user completes a change)

Triggered by `/understand-learn --continue` when `phase === "exercise_in_progress"` or when the user has made changes.

### 1. Ask the user to predict impact FIRST

> 在分析 Diff 前，请先预测这次修改会影响哪些组件和行为。

**STOP.** Wait for their answer.

### 2. Analyze the diff

Get changed files:

```bash
git -C "$PROJECT_ROOT" diff --name-only
# or for staged: git diff --cached --name-only
# or branch: git diff main...HEAD --name-only
```

For each changed file:
1. Grep the knowledge graph for the matching node (`filePath`).
2. Find 1-hop neighbors via `edges` (both directions).
3. Identify affected layers via `layers[]`.

### 3. Present review

```text
直接修改：
间接受影响（1-hop）：
跨层影响：
用户预测正确的部分：
用户遗漏的部分：
实际风险：
建议补充的测试：
本次学习结论：
```

Compare against the user's prediction. Highlight what they caught and what they missed.

Update state:

```bash
node "$STATE_SCRIPT" "$PROJECT_ROOT" update-phase completed
```

Optionally generate a learning note from the template at `$SKILL_DIR/templates/learning-note.md` and save to `$UA_DIR/learning/notes/<sessionId>.md`.

---

## Learning state machine

Phases (in order):

```
preflight → overview → selecting_feature → learning_path_ready →
predicting → verifying → checking_understanding →
[next file] → ... → exercise_ready → exercise_in_progress →
reviewing_diff → completed
```

State is stored at `$UA_DIR/learning/current.json` and archived to `$UA_DIR/learning/sessions/<sessionId>.json` on every change.

Do not force formality, but the state MUST support `--continue` across sessions.

---

## Error handling

| Condition | Action |
|-----------|--------|
| Knowledge graph missing | Tell user to run `/understand` first |
| File not found in graph | Suggest closest node by path similarity |
| `--goal` matches nothing | Recommend closest terms from graph tags/names |
| `current.json` corrupt | Backed up automatically by state script; start fresh |
| `current.json` belongs to another project | Do not continue; warn user |
| File in learning path deleted | Re-refresh graph or relocate node |
| Graph stale (files changed) | Warn, suggest `/understand`, allow best-effort |

---

## Output constraints

**Do NOT:**
- Explain the entire repository in one turn
- Translate source code line-by-line
- List dozens of files at once
- Skip the prediction or understanding-check phases without user input
- Rely solely on graph summaries for implementation details
- Present LLM inference as confirmed fact
- Ignore graph staleness risk
- Modify user business code without being asked
- Commit or push code on the user's behalf
- Add learning state files to Git unless explicitly asked
- Narrate tool calls or show hidden reasoning

**DO:**
- Teach one file per turn
- Stop after prediction tasks and understanding checks
- Read real source code for every file you teach
- Distinguish graph facts, source facts, and inferences
- Use the user's chosen output language for prose
- Keep technical identifiers and file paths verbatim

---

## Relationship to other skills

This skill **orchestrates** the methods of the existing skills without replacing them:
- `/understand` — produces the graph this skill reads
- `/understand-onboard` — overview method informed by its layer/concept/tour approach
- `/understand-chat` — node search and edge tracing patterns
- `/understand-explain` — deep-dive single-file teaching method
- `/understand-diff` — diff-to-node mapping and 1-hop impact analysis

Reuse their conventions for graph freshness, node retrieval, and layer analysis. Do not duplicate their logic.
