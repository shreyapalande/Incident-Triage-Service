/**
 * Triage a single incident against /api/triage-eval (no DB writes) and print
 * the result. Useful for quickly poking at one prompt/schema change without
 * running the full test_cases.json suite.
 *
 * Usage:
 *   npm run eval:one -- --title "DB CPU at 95%" --description "..."
 *   npm run eval:one -- --title "..." --source datadog
 */

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

function parseArgs(argv: string[]): { source: string; title?: string; description?: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }

  if (!args.title && !args.description) {
    throw new Error("Provide at least --title or --description");
  }

  return { source: args.source ?? "manual", title: args.title, description: args.description };
}

async function main() {
  let input: ReturnType<typeof parseArgs>;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(
      '\nUsage: npm run eval:one -- --title "..." [--description "..."] [--source "..."]',
    );
    process.exit(1);
  }

  console.log(`Triaging against ${BASE_URL}/api/triage-eval ...\n`);
  console.log(`  source:      ${input.source}`);
  if (input.title) console.log(`  title:       ${input.title}`);
  if (input.description) console.log(`  description: ${input.description}`);
  console.log();

  const res = await fetch(`${BASE_URL}/api/triage-eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json();

  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`severity:          ${body.severity}`);
  console.log(`category:          ${body.category}`);
  console.log(`summary:           ${body.summary}`);
  console.log(`recommendedAction: ${body.recommendedAction}`);
}

main();
