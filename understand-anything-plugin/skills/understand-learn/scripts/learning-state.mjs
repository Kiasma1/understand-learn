#!/usr/bin/env node
/**
 * learning-state.mjs
 *
 * Deterministic state management for the /understand-learn skill.
 * Handles session lifecycle, atomic persistence, and project validation.
 * Contains NO LLM/teaching logic — only file I/O and validation.
 *
 * Usage:
 *   node learning-state.mjs <projectRoot> <command> [args]
 *
 * Commands:
 *   validate                          — exit 0 if current.json matches projectRoot
 *   create <goal> <mode>             — create new session, write current.json + sessions/<id>.json
 *   status                           — print current session summary as JSON
 *   update-phase <phase> [patchJson] — update phase + merge optional patch
 *   complete-file <filePath> [nodeId] — mark a file completed, advance currentFileIndex
 *   reset                            — delete current.json, keep sessions/
 *   graph-commit                     — print graphCommitHash from knowledge-graph.json
 *   resolve                          — resolve UA_DIR, paths, output language (absorbs pre-flight bash)
 *   parse-args <arguments>           — parse $ARGUMENTS into {mode, goal, filePath}
 *   check-freshness                  — compare graph commit vs HEAD, report staleness
 *
 * State directory: $UA_DIR/learning/ (resolved via legacy-first rule)
 *   current.json         — active session
 *   sessions/<sessionId>.json — historical snapshots
 *   notes/<sessionId>.md     — optional learning notes
 *
 * Exit codes:
 *   0  success
 *   1  usage error / unknown command
 *   2  knowledge graph missing (run /understand first)
 *   3  projectRoot mismatch
 *   4  corrupt state (backed up, not overwritten)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UA_DIR_NEW = ".ua";
const UA_DIR_LEGACY = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";
const CONFIG_FILE = "config.json";
const LEARNING_DIR = "learning";
const SESSIONS_DIR = "sessions";
const NOTES_DIR = "notes";
const CURRENT_FILE = "current.json";
const STATE_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve the data dir NAME (legacy-first rule, mirrors core/persistence). */
function resolveUaDirName(projectRoot) {
  return existsSync(join(projectRoot, UA_DIR_LEGACY))
    ? UA_DIR_LEGACY
    : UA_DIR_NEW;
}

/** Absolute path to the project's learning state directory. */
function resolveLearningDir(projectRoot) {
  return join(projectRoot, resolveUaDirName(projectRoot), LEARNING_DIR);
}

/** Ensure the learning/ subdir (and sessions/, notes/) exist. */
function ensureLearningDir(projectRoot) {
  const base = resolveLearningDir(projectRoot);
  for (const sub of ["", SESSIONS_DIR, NOTES_DIR]) {
    const dir = sub ? join(base, sub) : base;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return base;
}

function currentPath(projectRoot) {
  return join(resolveLearningDir(projectRoot), CURRENT_FILE);
}

function sessionPath(projectRoot, sessionId) {
  return join(resolveLearningDir(projectRoot), SESSIONS_DIR, `${sessionId}.json`);
}

function graphPath(projectRoot) {
  return join(projectRoot, resolveUaDirName(projectRoot), GRAPH_FILE);
}

function configPath(projectRoot) {
  return join(projectRoot, resolveUaDirName(projectRoot), CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/** Write JSON atomically: tmp then rename. Never leaves a half-written file. */
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

function makeSessionId(goal) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const slug = goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-")
    .slice(0, 40);
  return `${date}${slug ? "-" + slug : "session"}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// State read/write
// ---------------------------------------------------------------------------

/**
 * Read current session state. Returns:
 *   { state }          on success
 *   { corrupt: true, backupPath }  if JSON parse fails (file backed up)
 *   { missing: true }  if no current.json
 */
function readState(projectRoot) {
  const p = currentPath(projectRoot);
  if (!existsSync(p)) {
    return { missing: true };
  }
  const raw = readFileSync(p, "utf-8");
  try {
    return { state: JSON.parse(raw) };
  } catch (err) {
    // Back up corrupt file before reporting.
    const backup = `${p}.corrupt.${Date.now()}`;
    try {
      renameSync(p, backup);
    } catch {
      // If rename also fails, leave the original; report corrupt anyway.
      return { corrupt: true, backupPath: null, error: err.message };
    }
    return { corrupt: true, backupPath: backup, error: err.message };
  }
}

function writeState(projectRoot, state) {
  ensureLearningDir(projectRoot);
  const p = currentPath(projectRoot);
  atomicWriteJson(p, state);
}

/** Persist a snapshot into sessions/<sessionId>.json (history). */
function archiveSession(projectRoot, state) {
  ensureLearningDir(projectRoot);
  const p = sessionPath(projectRoot, state.sessionId);
  atomicWriteJson(p, state);
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

/** Read graphCommitHash from the knowledge graph, or null if unavailable. */
function readGraphCommitHash(projectRoot) {
  const p = graphPath(projectRoot);
  if (!existsSync(p)) return null;
  try {
    const graph = JSON.parse(readFileSync(p, "utf-8"));
    return graph?.project?.gitCommitHash ?? null;
  } catch {
    return null;
  }
}

/** Read outputLanguage from config.json, or null. */
function readOutputLanguage(projectRoot) {
  const p = configPath(projectRoot);
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, "utf-8"));
    return cfg?.outputLanguage ?? null;
  } catch {
    return null;
  }
}

function graphExists(projectRoot) {
  return existsSync(graphPath(projectRoot));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdValidate(projectRoot) {
  const { state, missing, corrupt } = readState(projectRoot);
  if (missing) {
    process.stderr.write(`No active learning session in ${projectRoot}\n`);
    process.exit(1);
  }
  if (corrupt) {
    process.stderr.write(`Corrupt learning state. See backup.\n`);
    process.exit(4);
  }
  if (state.projectRoot !== projectRoot) {
    process.stderr.write(
      `Project mismatch: state is for "${state.projectRoot}", not "${projectRoot}"\n`,
    );
    process.exit(3);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, sessionId: state.sessionId, phase: state.phase }) + "\n",
  );
}

function cmdCreate(projectRoot, goal, mode) {
  if (!goal) {
    process.stderr.write("create requires <goal>\n");
    process.exit(1);
  }
  const resolvedMode = mode || "feature";
  const sessionId = makeSessionId(goal);
  const ts = nowIso();
  const graphCommitHash = readGraphCommitHash(projectRoot);
  const state = {
    version: STATE_VERSION,
    sessionId,
    projectRoot,
    graphCommitHash,
    goal,
    mode: resolvedMode,
    phase: "preflight",
    learningPath: [],
    currentFileIndex: 0,
    completedFiles: [],
    openQuestions: [],
    exercise: null,
    createdAt: ts,
    updatedAt: ts,
  };
  ensureLearningDir(projectRoot);
  writeState(projectRoot, state);
  archiveSession(projectRoot, state);
  process.stdout.write(JSON.stringify({ ok: true, sessionId, phase: state.phase }) + "\n");
}

function cmdStatus(projectRoot) {
  const { state, missing, corrupt } = readState(projectRoot);
  if (missing) {
    process.stdout.write(JSON.stringify({ hasSession: false }) + "\n");
    return;
  }
  if (corrupt) {
    process.stdout.write(
      JSON.stringify({ hasSession: false, corrupt: true }) + "\n",
    );
    return;
  }
  const total = state.learningPath.length;
  const completed = state.completedFiles.length;
  const current =
    total > 0 && state.currentFileIndex < total
      ? state.learningPath[state.currentFileIndex]
      : null;
  process.stdout.write(
    JSON.stringify({
      hasSession: true,
      sessionId: state.sessionId,
      goal: state.goal,
      mode: state.mode,
      phase: state.phase,
      progress: { completed, total, currentFile: current?.filePath ?? null },
      projectMatch: state.projectRoot === projectRoot,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }) + "\n",
  );
}

function cmdUpdatePhase(projectRoot, phase, patchJson) {
  const { state, missing, corrupt } = readState(projectRoot);
  if (missing) {
    process.stderr.write("No active session. Use create first.\n");
    process.exit(1);
  }
  if (corrupt) {
    process.stderr.write("Corrupt state.\n");
    process.exit(4);
  }
  state.phase = phase;
  if (patchJson) {
    try {
      Object.assign(state, JSON.parse(patchJson));
    } catch {
      process.stderr.write("Invalid patch JSON\n");
      process.exit(1);
    }
  }
  state.updatedAt = nowIso();
  writeState(projectRoot, state);
  archiveSession(projectRoot, state);
  process.stdout.write(JSON.stringify({ ok: true, phase: state.phase }) + "\n");
}

function cmdCompleteFile(projectRoot, filePath, nodeId) {
  const { state, missing, corrupt } = readState(projectRoot);
  if (missing) {
    process.stderr.write("No active session.\n");
    process.exit(1);
  }
  if (corrupt) {
    process.stderr.write("Corrupt state.\n");
    process.exit(4);
  }
  // Find the entry in learningPath by filePath.
  const entry = state.learningPath.find((e) => e.filePath === filePath);
  if (entry) {
    entry.status = "completed";
    if (nodeId) entry.nodeId = nodeId;
  }
  if (!state.completedFiles.includes(filePath)) {
    state.completedFiles.push(filePath);
  }
  // Advance currentFileIndex past completed entries.
  while (
    state.currentFileIndex < state.learningPath.length &&
    state.learningPath[state.currentFileIndex].status === "completed"
  ) {
    state.currentFileIndex++;
  }
  // Mark next entry current.
  if (
    state.currentFileIndex < state.learningPath.length &&
    state.learningPath[state.currentFileIndex].status !== "completed"
  ) {
    state.learningPath[state.currentFileIndex].status = "current";
  }
  state.updatedAt = nowIso();
  writeState(projectRoot, state);
  archiveSession(projectRoot, state);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      completedFiles: state.completedFiles,
      currentFileIndex: state.currentFileIndex,
    }) + "\n",
  );
}

function cmdReset(projectRoot) {
  const cur = currentPath(projectRoot);
  if (existsSync(cur)) {
    unlinkSync(cur);
  }
  process.stdout.write(JSON.stringify({ ok: true, reset: true }) + "\n");
}

function cmdGraphCommit(projectRoot) {
  const hash = readGraphCommitHash(projectRoot);
  process.stdout.write(JSON.stringify({ gitCommitHash: hash }) + "\n");
}

// ---------------------------------------------------------------------------
// Pre-flight helpers (absorb bash parsing from SKILL.md)
// ---------------------------------------------------------------------------

/**
 * Resolve all paths the skill needs. Outputs JSON:
 *   { uaDir, uaDirName, graphPath, graphExists, stateScript, configPath, outputLanguage }
 */
function cmdResolve(projectRoot) {
  const uaDirName = resolveUaDirName(projectRoot);
  const uaDir = join(projectRoot, uaDirName);
  const graphPathResolved = graphPath(projectRoot);
  const cfgPath = configPath(projectRoot);
  const outputLang = readOutputLanguage(projectRoot);
  process.stdout.write(
    JSON.stringify({
      uaDir,
      uaDirName,
      graphPath: graphPathResolved,
      graphExists: existsSync(graphPathResolved),
      stateScript: join(__dirname, "learning-state.mjs"),
      configPath: cfgPath,
      outputLanguage: outputLang,
    }) + "\n",
  );
}

/**
 * Parse $ARGUMENTS into structured mode/goal/filePath.
 * Priority: --reset > --status > --continue > explicit --mode > default feature.
 * Outputs JSON: { mode, goal, filePath, arguments }
 */
function cmdParseArgs(projectRoot, argumentsStr) {
  const args = argumentsStr || "";
  let mode = "feature";
  let goal = "";
  let filePath = "";

  if (args.includes("--reset")) mode = "reset";
  else if (args.includes("--status")) mode = "status";
  else if (args.includes("--continue")) mode = "continue";
  else if (args.includes("--mode overview")) mode = "overview";
  else if (args.includes("--mode feature")) mode = "feature";
  else if (args.includes("--mode file ")) mode = "file";

  // Extract --goal value: everything after --goal up to next --flag or end
  const goalMatch = args.match(/--goal\s+(.*?)(?=\s+--|$)/);
  if (goalMatch) {
    goal = goalMatch[1].trim();
    // Strip surrounding quotes (single or double)
    goal = goal.replace(/^["']|["']$/g, "");
  }

  // Extract file path for --mode file
  const fileMatch = args.match(/--mode file\s+(\S+)/);
  if (fileMatch) filePath = fileMatch[1];

  process.stdout.write(
    JSON.stringify({ mode, goal, filePath, arguments: args }) + "\n",
  );
}

/**
 * Check graph freshness vs HEAD. Outputs JSON:
 *   { graphCommit, headCommit, committedDiff, stagedDiff, unstagedDiff, untracked, stale, warnings[] }
 */
function cmdCheckFreshness(projectRoot) {
  const warnings = [];
  const graphCommitRaw = readGraphCommitHash(projectRoot);

  let graphCommit = null;
  let headCommit = null;
  let committedDiff = [];
  let stagedDiff = [];
  let unstagedDiff = [];
  let untracked = [];
  let stale = false;

  if (!graphCommitRaw) {
    warnings.push("No gitCommitHash in knowledge graph; cannot check freshness.");
    process.stdout.write(JSON.stringify({ stale: false, warnings }));
    return;
  }

  // Resolve graph commit
  try {
    graphCommit = execGit(projectRoot, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${graphCommitRaw}^{commit}`,
    ]);
  } catch {
    warnings.push(`Graph commit ${graphCommitRaw} not found in local git.`);
    process.stdout.write(JSON.stringify({ stale: false, warnings }));
    return;
  }

  // HEAD
  try {
    headCommit = execGit(projectRoot, ["rev-parse", "HEAD"]);
  } catch {
    warnings.push("No HEAD found; git repo may be empty.");
    process.stdout.write(JSON.stringify({ stale: false, warnings }));
    return;
  }

  if (graphCommit === headCommit) {
    // Graph is current; still check working tree
    try {
      unstagedDiff = execGit(projectRoot, ["diff", "--name-only", "--", "."])
        .split("\n")
        .filter(Boolean);
    } catch {}
    try {
      untracked = execGit(projectRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        ".",
      ])
        .split("\n")
        .filter(Boolean);
    } catch {}
    if (unstagedDiff.length > 0 || untracked.length > 0) {
      stale = true;
      warnings.push("Working tree has uncommitted changes since graph was built.");
    }
    process.stdout.write(
      JSON.stringify({
        graphCommit,
        headCommit,
        committedDiff,
        stagedDiff,
        unstagedDiff,
        untracked,
        stale,
        warnings,
      }) + "\n",
    );
    return;
  }

  // Graph commit differs from HEAD — something changed since graph was built
  try {
    committedDiff = execGit(projectRoot, [
      "diff",
      "--name-only",
      graphCommit,
      "HEAD",
      "--",
      ".",
    ])
      .split("\n")
      .filter(Boolean);
  } catch {
    warnings.push("Could not diff graph commit vs HEAD.");
  }

  try {
    stagedDiff = execGit(projectRoot, [
      "diff",
      "--cached",
      "--name-only",
      "--",
      ".",
    ])
      .split("\n")
      .filter(Boolean);
  } catch {}

  try {
    unstagedDiff = execGit(projectRoot, ["diff", "--name-only", "--", "."])
      .split("\n")
      .filter(Boolean);
  } catch {}

  try {
    untracked = execGit(projectRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ".",
    ])
      .split("\n")
      .filter(Boolean);
  } catch {}

  // Filter out the data dir itself
  const uaDirName = resolveUaDirName(projectRoot);
  const filterDataDir = (arr) =>
    arr.filter((f) => !f.startsWith(`${uaDirName}/`) && f !== uaDirName);

  const meaningfulCommitted = filterDataDir(committedDiff);
  const meaningfulStaged = filterDataDir(stagedDiff);
  const meaningfulUnstaged = filterDataDir(unstagedDiff);
  const meaningfulUntracked = filterDataDir(untracked);

  if (
    meaningfulCommitted.length > 0 ||
    meaningfulStaged.length > 0 ||
    meaningfulUnstaged.length > 0 ||
    meaningfulUntracked.length > 0
  ) {
    stale = true;
    warnings.push(
      "Knowledge graph is stale: files changed since it was built. Run /understand to refresh.",
    );
  }

  process.stdout.write(
    JSON.stringify({
      graphCommit,
      headCommit,
      committedDiff: meaningfulCommitted,
      stagedDiff: meaningfulStaged,
      unstagedDiff: meaningfulUnstaged,
      untracked: meaningfulUntracked,
      stale,
      warnings,
    }) + "\n",
  );
}

function execGit(projectRoot, args) {
  const { execSync } = require("child_process");
  return execSync(`git -C "${projectRoot}" ${args.join(" ")}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}


// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write(
      "usage: node learning-state.mjs <projectRoot> <command> [args]\n",
    );
    process.exit(1);
  }
  const [projectRootRaw, command, ...rest] = args;
  const projectRoot = resolve(projectRootRaw);

  switch (command) {
    case "validate":
      cmdValidate(projectRoot);
      break;
    case "create": {
      const [goal, mode] = rest;
      cmdCreate(projectRoot, goal, mode);
      break;
    }
    case "status":
      cmdStatus(projectRoot);
      break;
    case "update-phase": {
      const [phase, patchJson] = rest;
      if (!phase) {
        process.stderr.write("update-phase requires <phase>\n");
        process.exit(1);
      }
      cmdUpdatePhase(projectRoot, phase, patchJson);
      break;
    }
    case "complete-file": {
      const [filePath, nodeId] = rest;
      if (!filePath) {
        process.stderr.write("complete-file requires <filePath>\n");
        process.exit(1);
      }
      cmdCompleteFile(projectRoot, filePath, nodeId);
      break;
    }
    case "reset":
      cmdReset(projectRoot);
      break;
    case "graph-commit":
      cmdGraphCommit(projectRoot);
      break;
    case "resolve":
      cmdResolve(projectRoot);
      break;
    case "parse-args": {
      const [argumentsStr] = rest;
      cmdParseArgs(projectRoot, argumentsStr);
      break;
    }
    case "check-freshness":
      cmdCheckFreshness(projectRoot);
      break;
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      process.exit(1);
  }
}

if (isCliEntry()) {
  main().catch((err) => {
    process.stderr.write(`learning-state failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports (for potential future test import without CLI side effects)
// ---------------------------------------------------------------------------

export {
  resolveUaDirName,
  resolveLearningDir,
  ensureLearningDir,
  readState,
  writeState,
  readGraphCommitHash,
  readOutputLanguage,
  graphExists,
  makeSessionId,
  atomicWriteJson,
};
