import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./agent";
import { anthropicModel } from "./model";
import { loadCases, addCase, type Case } from "./golden";
import { score, type Check } from "./score";

// The judge is a fixed model, not the router: a grader whose tier changes
// from case to case is two graders. Ideally it comes from a different model
// family than the agent, which grades its own family's answers too kindly.
const JUDGE = anthropicModel("claude-sonnet-4-6");

type CaseResult = { id: string; passed: boolean; runs: number; passes: number; cost: number; failures: string[] };
type Report = { commit: string; date: string; cases: Record<string, CaseResult> };

// An eval run is an agent run with an assertion on top. Each one gets a fresh
// copy of the memory directory, so a fact one case writes cannot change the
// next case: an evaluation must not alter the system it measures.
async function evaluate(c: Case, runs: number): Promise<CaseResult> {
  let passes = 0;
  let cost = 0;
  const failures: string[] = [];
  for (let i = 0; i < runs; i++) {
    const memory = mkdtempSync(join(tmpdir(), "eval-memory-"));
    cpSync("memory", memory, { recursive: true });
    process.env.MEMORY_DIR = memory;
    // Journals too (post-11): an eval run leaves nothing behind in runs/.
    const runs = mkdtempSync(join(tmpdir(), "eval-runs-"));
    process.env.RUNS_DIR = runs;
    try {
      // approvals: "deny" -- an evaluation must not wait for a person, and must
      // not change anything a person would have had to approve.
      const result = await run(c.input, { approvals: "deny" });
      const checks: Check[] = await score(c, result, JUDGE);
      cost += result.cost;
      const failed = checks.filter((k) => !k.pass);
      if (failed.length === 0) passes++;
      else failures.push(...failed.map((k) => `${k.scorer}: ${k.detail}`));
    } finally {
      rmSync(memory, { recursive: true, force: true });
      rmSync(runs, { recursive: true, force: true });
    }
  }
  // Models are not deterministic, so a case runs several times and passes on
  // a majority. One run per case measures luck as often as behaviour.
  return { id: c.id, passed: passes * 2 > runs, runs, passes, cost, failures };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[2] === "add") {
  // bun eval.ts add "<input that went wrong>" --rubric "<what a right answer does>"
  const rubric = arg("--rubric");
  if (!process.argv[3] || !rubric) {
    console.error('usage: bun eval.ts add "<input>" --rubric "<what a right answer does>"');
    process.exit(1);
  }
  const c = await addCase(process.argv[3], rubric);
  console.log(`added case ${c.id}`);
  process.exit(0);
}

const runs = Number(arg("--runs") ?? 3);
const only = arg("--only");
const cases = (await loadCases()).filter((c) => !only || c.id === only);
const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
const report: Report = { commit, date: new Date().toISOString(), cases: {} };

for (const c of cases) {
  const r = await evaluate(c, runs);
  report.cases[c.id] = r;
  console.log(
    `${r.passed ? "pass" : "FAIL"}  ${r.id.padEnd(30)} ${r.passes}/${r.runs}  $${r.cost.toFixed(3)}` +
      (r.failures.length ? `  ${r.failures[0]}` : ""),
  );
}

const results = Object.values(report.cases);
const passed = results.filter((r) => r.passed).length;
const total = results.reduce((sum, r) => sum + r.cost, 0);
console.log(`\n${passed}/${results.length} cases pass, agent cost $${total.toFixed(2)}`);
await Bun.write(arg("--save") ?? "evals/results/latest.json", JSON.stringify(report, null, 2) + "\n");

// Regression mode: compare against a saved report and fail the build when a
// case that passed there fails here. The pass rate alone hides a swap, one
// case fixed and another broken.
const baselineFile = arg("--baseline");
if (baselineFile) {
  const baseline: Report = await Bun.file(baselineFile).json();
  const broken = results.filter((r) => !r.passed && baseline.cases[r.id]?.passed);
  for (const r of broken) console.log(`regression: ${r.id} passed at ${baseline.commit}, fails at ${commit}`);
  if (broken.length > 0) process.exit(1);
}
