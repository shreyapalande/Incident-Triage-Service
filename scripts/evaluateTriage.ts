import fs from "node:fs";
import path from "node:path";

interface TestCase {
  id: number | string;
  difficulty: string;
  title: string;
  description?: string;
  expected_severity: string;
  expected_category: string;
  notes?: string;
}

interface TriageResult {
  severity: string;
  category: string;
  summary: string;
  recommendedAction: string;
}

interface CaseResult {
  case: TestCase;
  actual: TriageResult | null;
  error: string | null;
  severityMatch: boolean;
  categoryMatch: boolean;
  fullMatch: boolean;
}

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const TEST_FILE = process.argv[2] ?? path.join(process.cwd(), "test_cases.json");

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

async function triageOne(testCase: TestCase): Promise<CaseResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/triage-eval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "eval",
        title: testCase.title,
        description: testCase.description,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        case: testCase,
        actual: null,
        error: `HTTP ${res.status}: ${body}`,
        severityMatch: false,
        categoryMatch: false,
        fullMatch: false,
      };
    }

    const actual = (await res.json()) as TriageResult;
    const severityMatch = normalize(actual.severity) === normalize(testCase.expected_severity);
    const categoryMatch = normalize(actual.category) === normalize(testCase.expected_category);

    return {
      case: testCase,
      actual,
      error: null,
      severityMatch,
      categoryMatch,
      fullMatch: severityMatch && categoryMatch,
    };
  } catch (err) {
    return {
      case: testCase,
      actual: null,
      error: err instanceof Error ? err.message : String(err),
      severityMatch: false,
      categoryMatch: false,
      fullMatch: false,
    };
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "n/a" : `${((n / total) * 100).toFixed(1)}%`;
}

function summarizeGroup(label: string, results: CaseResult[]): void {
  const total = results.length;
  const full = results.filter((r) => r.fullMatch).length;
  const severity = results.filter((r) => r.severityMatch).length;
  const category = results.filter((r) => r.categoryMatch).length;
  console.log(
    `  ${label.padEnd(14)} n=${String(total).padEnd(3)} full=${pct(full, total).padEnd(7)} severity=${pct(severity, total).padEnd(7)} category=${pct(category, total)}`,
  );
}

async function main() {
  if (!fs.existsSync(TEST_FILE)) {
    console.error(`Test file not found: ${TEST_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(TEST_FILE, "utf-8"));
  const testCases: TestCase[] = raw.test_cases ?? raw;

  if (!Array.isArray(testCases) || testCases.length === 0) {
    console.error("No test cases found in file");
    process.exit(1);
  }

  console.log(`Running ${testCases.length} test cases against ${BASE_URL}/api/triage-eval ...\n`);

  const results: CaseResult[] = [];
  for (const testCase of testCases) {
    process.stdout.write(`  case ${testCase.id} (${testCase.difficulty})... `);
    const result = await triageOne(testCase);
    console.log(result.error ? "ERROR" : result.fullMatch ? "match" : "mismatch");
    results.push(result);
  }

  console.log("\n=== Summary ===");
  summarizeGroup("overall", results);

  console.log("\n=== By difficulty ===");
  const difficulties = [...new Set(results.map((r) => r.case.difficulty))];
  for (const difficulty of difficulties) {
    summarizeGroup(difficulty, results.filter((r) => r.case.difficulty === difficulty));
  }

  const mismatches = results.filter((r) => !r.fullMatch);
  console.log(`\n=== Mismatches (${mismatches.length}/${results.length}) ===`);
  if (mismatches.length === 0) {
    console.log("  none");
  } else {
    for (const r of mismatches) {
      console.log(`\n  [${r.case.id}] (${r.case.difficulty}) ${r.case.title}`);
      if (r.error) {
        console.log(`    ERROR: ${r.error}`);
        continue;
      }
      console.log(
        `    severity: expected=${r.case.expected_severity} actual=${r.actual!.severity} ${r.severityMatch ? "OK" : "MISMATCH"}`,
      );
      console.log(
        `    category: expected=${r.case.expected_category} actual=${r.actual!.category} ${r.categoryMatch ? "OK" : "MISMATCH"}`,
      );
      console.log(`    actual summary: ${r.actual!.summary}`);
      if (r.case.notes) console.log(`    notes: ${r.case.notes}`);
    }
  }
}

main();
