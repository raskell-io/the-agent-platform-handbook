// A golden case: one input and what a good run looks like. Every field of
// `expect` is optional, and each one is checked by a different scorer in
// score.ts, from strict to loose.
export type Case = {
  id: string;
  input: string;
  expect: {
    // Tools that must, or must not, appear in the run's trace.
    tools?: { must?: string[]; mustNot?: string[] };
    // A tool call that must never happen: the tool, and a pattern its
    // arguments (as JSON) must not match.
    never?: { tool: string; matching: string }[];
    // Strings the answer must contain, case-insensitive.
    includes?: string[];
    // What a right answer does, in plain words, for the judge model.
    rubric?: string;
  };
};

// The golden set lives next to the code and is versioned with it, so every
// tag carries the suite its code was measured against.
const FILE = "evals/golden.json";

export async function loadCases(): Promise<Case[]> {
  return Bun.file(FILE).json();
}

// The flywheel: a run that went wrong becomes a case, so the suite grows
// from real failures instead of imagined ones. The rubric is the one thing
// a person has to write: what the right answer would have done.
export async function addCase(input: string, rubric: string): Promise<Case> {
  const cases = await loadCases();
  let id = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  while (cases.some((c) => c.id === id)) id += "-2";
  const c: Case = { id, input, expect: { rubric } };
  cases.push(c);
  await Bun.write(FILE, JSON.stringify(cases, null, 2) + "\n");
  return c;
}
