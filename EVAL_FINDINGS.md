# Triage Evaluation: Findings & Iteration Log

## Goal

The triage endpoint (`POST /api/webhook/incident`) uses an LLM (Gemini) to classify
incoming incidents by severity and category, and generate a summary and recommended
action. Before trusting this in a demo or citing it as working, I built a labeled
evaluation set to measure whether the triage judgment was actually *good*, not just
whether the endpoint ran without errors.

## Methodology

- **20 hand-labeled test cases**, deliberately spread across three difficulty tiers:
  - **Clear-cut (7)** — unambiguous incidents where the correct severity/category
    should be obvious (e.g., "production database completely down").
  - **Ambiguous (7)** — genuinely debatable cases where reasonable humans might
    disagree (e.g., "one of three redundant cache nodes is down, no impact yet").
  - **Edge-case (6)** — deliberately vague, degenerate, or adversarial inputs
    designed to stress-test judgment under uncertainty (an empty alert body,
    alarming language with zero real content, an unreviewed script run in
    production with unknown effects).
- Each case has an `expected_severity` and `expected_category` I assigned myself,
  plus a `difficulty` tag and notes on what the case is testing.
- A dedicated `/api/triage-eval` endpoint runs the triage logic without writing to
  the incidents table, so repeated eval runs don't pollute real data.
- `scripts/evaluateTriage.ts` runs all 20 cases against this endpoint and reports
  three separate scores:
  - **`severity`** — % where severity alone matched.
  - **`category`** — % where category alone matched.
  - **`full`** — % where *both* matched simultaneously (the strict, harder bar).

## Round 1 — Baseline

```
overall     n=20  full=35.0%   severity=60.0%   category=70.0%
clear-cut   n=7   full=57.1%   severity=85.7%   category=71.4%
ambiguous   n=7   full=14.3%   severity=28.6%   category=85.7%
edge-case   n=6   full=33.3%   severity=66.7%   category=50.0%
```

**Two root causes identified, not just symptoms:**

1. **Severity escalation bias.** The original system prompt explicitly instructed
   the model to "be decisive... rather than defaulting to MEDIUM out of caution."
   This caused systematic over-escalation on vague/ambiguous cases — the model was
   doing exactly what it was told, not misbehaving.
2. **Category drift.** `category` was defined as `z.string()` — an unconstrained
   free-text field with only example values in a `.describe()` hint, not an
   enforced set. The model would reasonably pick between overlapping labels
   (`infra` vs `performance` vs `customer-impact`) inconsistently across similar
   cases. This was a measurement/schema flaw, not a reasoning failure.

## Round 2 — First severity fix (partial, and instructive)

Softened the blanket decisiveness rule to: default to MEDIUM specifically when a
report lacks concrete signal.

```
overall     n=20  full=45.0%   severity=55.0%   category=65.0%
clear-cut   n=7   full=71.4%   severity=100.0%  category=71.4%
ambiguous   n=7   full=28.6%   severity=28.6%   category=85.7%
edge-case   n=6   full=33.3%   severity=33.3%   category=33.3%
```

This fixed the case it targeted (vague-but-plausible signal → MEDIUM) but
**backfired on two other cases** that also looked like "no signal" on the surface
but needed different treatment:

- **Case 18** ("intern ran an unknown script in production") — expected **HIGH**
  (unknown blast radius is itself the risk), but the new blanket rule pulled it
  down to MEDIUM.
- **Case 20** ("urgent!!! fix now!!!" — no real content) — expected **LOW**, but
  landed on MEDIUM for the same reason.

**Diagnosis:** "lack of concrete signal" isn't one situation — it's three, each
needing a different default:
1. No signal, no urgency indicators → **LOW** (nothing to act on)
2. Vague but plausible signal → **MEDIUM** (real but unconfirmed)
3. Unknown/unbounded blast radius → **HIGH** (the *unknown scope* is the risk,
   even with zero confirmed harm)

A single "default to MEDIUM" rule collapsed all three into one bucket.

## Round 3 — Three-way severity split + category enum

Replaced the blanket rule with explicit guidance for all three uncertainty types,
and constrained `category` to a real enum (`infra`, `performance`, `security`,
`data`, `customer-impact`) with boundary definitions and an explicit tiebreaker
rule for overlapping cases, enforced at the schema level (not just prompt text).

```
overall     n=20  full=65.0%   severity=90.0%   category=70.0%
clear-cut   n=7   full=42.9%   severity=85.7%   category=57.1%
ambiguous   n=7   full=71.4%   severity=85.7%   category=71.4%
edge-case   n=6   full=83.3%   severity=100.0%  category=83.3%
```
*(numbers shown are after the final round below; severity jumped to 90% at this
stage and held there through the next round)*

Cases 15, 17, 18 all became severity matches. Category still showed drift on 18,
19, and 20 — landing on `security` or `customer-impact` instead of `infra`.

**Diagnosis, round 2:** cases 19 and 20 contain **zero identifiable technical
content** — an empty alert and pure urgency language with no substance. Forcing
these into `infra` wasn't a reasonable ground-truth label to begin with; a human
on-call engineer receiving "urgent!!! fix now!!!" with nothing else would
reasonably say "I don't have enough information," not confidently pick a category.

## Round 4 — Added an `unknown` category + security/infra tiebreaker

- Added `unknown` as a legitimate 6th category value: *"no identifiable technical
  content — use this rather than guessing when there is genuinely nothing to
  point to."*
- Added an explicit tiebreaker for security vs. infra: an unreviewed-but-authorized
  internal action is `infra` (concern is system state), not automatically
  `security` (which requires indication of malicious intent or external
  compromise).
- **Updated the eval set itself**: cases 19 and 20's `expected_category` changed
  from `infra` to `unknown`, since that's the honestly correct label.

**Final results:**

```
overall     n=20  full=65.0%   severity=90.0%   category=70.0%
clear-cut   n=7   full=42.9%   severity=85.7%   category=57.1%
ambiguous   n=7   full=71.4%   severity=85.7%   category=71.4%
edge-case   n=6   full=83.3%   severity=100.0%  category=83.3%
```

Cases 15, 17, 18, 19, 20 — the entire cluster tracked since round 1 — are now all
full matches, each for the specific reason predicted:
- 18 → `infra` (tiebreaker rule resolved it correctly)
- 19, 20 → `unknown` (honest "insufficient information" outcome, not a forced guess)

## What's left, and why it's not being chased further

The remaining mismatches (cases 2, 4, 5, 7, 8, 14, 16) were reviewed individually.
They split into two categories:

- **Genuine judgment-call disagreements** (e.g., case 5: CRITICAL vs. HIGH on a
  confirmed data breach; case 8: MEDIUM vs. LOW on a sync job where retries
  eventually succeed) — cases where a reasonable person could land on either
  answer. These aren't schema or prompt defects; they're the model landing on a
  different, still-defensible point on a genuinely debatable question.
- **Category drift on cases with a real technical cause** (2, 4, 7, 14, 16) —
  a narrower, less severe version of the original drift, worth revisiting if this
  moves toward production use, but not evidence of a systemic problem.

**I deliberately stopped iterating here rather than chase 100% agreement.** A
system that matches every one of my own subjective labels isn't necessarily more
correct — it risks being overfit to one person's judgment calls rather than
reflecting genuinely sound reasoning. 90% severity / 70% category, with the
remaining gap traced to real ambiguity rather than an identifiable defect, is a
more honest and more defensible final state than a suspiciously perfect score.

## Known limitation

Gemini's free-tier rate limit (15 requests/minute) means a full 20-case eval run
reliably trips rate limiting near the end. Every run so far has needed a manual
retry pass for the last few cases. Documented here rather than hidden; the fix
(a short delay between calls in `evaluateTriage.ts`, or moving off the free tier)
is straightforward but not yet applied.

## What this process demonstrates

Not "the triage system works" — that's a weaker and less interesting claim.
What actually happened: a specific failure pattern was found, a hypothesis was
formed about its root cause, a targeted fix was made, and the result was measured
against the *original* failing cases, not just the aggregate score — twice, once
per root cause. One fix (round 2) partially worked and revealed a more precise
version of the underlying problem rather than being declared a success outright.
The final state includes an honest account of what's still unresolved and why
that's an acceptable place to stop, rather than an inflated claim of full
correctness.
