import type { Model } from "./model";
import { costOf } from "./price";

// Where the spend of one run accumulates. byModel attributes it to whoever
// actually answered, which is how the routing claim from post-07 gets checked.
export type Ledger = {
  turns: number;
  cost: number;
  byModel: Record<string, number>;
};

export function newLedger(): Ledger {
  return { turns: 0, cost: 0, byModel: {} };
}

// Read the usage every response already carries, price it, file it. Prices
// res.model, not the requested tier: the fallback may have overridden the
// router, and metering prices the truth, not the intent.
export function metered(inner: Model, ledger: Ledger): Model {
  return {
    name: `metered(${inner.name})`,
    async complete(req) {
      const res = await inner.complete(req);
      const cost = costOf(res.model, res.usage);
      ledger.turns += 1;
      ledger.cost += cost;
      ledger.byModel[res.model] = (ledger.byModel[res.model] ?? 0) + cost;
      return res;
    },
  };
}

export class BudgetExceeded extends Error {
  constructor(readonly spent: number, readonly cap: number) {
    super(`budget exceeded: $${spent.toFixed(4)} of $${cap.toFixed(2)}`);
  }
}

// A ledger with authority. Past 80% of the cap it degrades: the hard flag is
// cleared, so the router sends the cheap model. At the cap it refuses the turn.
export function withBudget(inner: Model, ledger: Ledger, capUSD: number): Model {
  const soft = capUSD * 0.8;
  return {
    name: `budget(${inner.name})`,
    complete(req) {
      if (ledger.cost >= capUSD) throw new BudgetExceeded(ledger.cost, capUSD);
      const overSoft = ledger.cost >= soft;
      // past the soft line, ride the cheap model regardless of the hard flag
      return inner.complete({ ...req, hard: req.hard && !overSoft });
    },
  };
}
