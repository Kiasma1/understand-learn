# Learning Method Reference

Pedagogical reference for the `/understand-learn` skill. Describes the teaching philosophy and why each phase exists.

## Core principle: active recall over passive delivery

Reading a file top-to-bottom while someone explains every line produces **passive familiarity** — the user nods along but cannot reconstruct the logic later. Active recall (predicting, then verifying) produces **durable understanding**.

This is why the skill stops after asking the user to predict. The discomfort of guessing wrong is the point: it primes the brain to remember the correct answer when revealed.

## Predict–verify loop

For each file:

1. **Context first** — give just enough (role, inputs, outputs, neighbors) for the user to reason about the file's job without seeing how it does it.
2. **Predict** — ask "what are the main steps?" not "what is the name of the function?". The former tests structural understanding; the latter tests memory.
3. **Verify** — map each prediction to reality, mark it, explain discrepancies with citations.
4. **One deep question** — a single question that requires connecting the file to its neighbors, not recalling a symbol name.

The loop is deliberately **slow**. A 5-file path takes ~5+ user interactions. That is a feature, not a bug.

## One file at a time

Cognitive load is the enemy of learning. Presenting three files at once lets the user skim and move on. Presenting one file and asking for a prediction forces engagement.

The skill also keeps context windows manageable: reading one file + its graph neighbors is cheap; reading five files at once wastes context that should go to the actual teaching.

## Distinguish fact from inference

Every teaching turn tags claims:

- **[图谱]** — architectural facts from the knowledge graph (may be stale or imprecise)
- **[源码]** — facts confirmed from reading the source right now
- **[推断]** — the model's own reasoning (hypothesis, not ground truth)

This stops the common failure mode where a stale graph summary gets repeated as if it were confirmed truth.

## Exercise design

A good exercise is **small, verifiable, and related to the path just learned**:

- Small: 1–3 files, no big refactors. The goal is reinforcement, not production work.
- Verifiable: clear acceptance criteria and a command (`barn test`, `npm test`, etc.) that proves it works.
- Related: touches the same files and concepts the user just studied.

A bad exercise is vague ("improve the logging"), too large ("add a new auth provider"), or unrelated to the path.

## Diff review as learning moment

After the user makes a change, asking them to predict the impact **before** showing the diff turns the review into an active-recall exercise. The gap between their prediction and the actual blast radius is the most valuable teaching signal — it calibrates their mental model of the codebase's connectivity.

## When graph staleness matters

If the graph is stale (files changed since `/understand`), the skill:
1. Warns the user prominently.
2. Suggests running `/understand` to refresh.
3. Allows limited best-effort learning (the user may proceed).
4. Lowers confidence on any impact analysis derived from the graph.

The skill **never silently uses stale summaries as if they were current**.

## Language handling

Prose follows the user's chosen language (from `$UA_DIR/config.json` `outputLanguage`, or inferred from session). Technical identifiers — function names, file paths, variable names, CLI flags — always stay in their original form. This avoids the absurdity of translating `authenticateUser` into a target language while keeping the code intact.
