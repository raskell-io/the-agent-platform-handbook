import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Tool } from "./types";

// A turn the loop hands to a model: the four things every provider needs, plus
// one routing signal the loop fills in. Note what is absent — no model string,
// no SDK type. The loop describes the work; it does not name who does it.
export type ModelRequest = {
  system: string;
  messages: MessageParam[];
  tools: Omit<Tool, "run">[];
  maxTokens: number;
  hard: boolean; // does this turn need the strong model?
};

// The dependency, inverted. The loop depends on this interface, not on a vendor
// SDK and not on a model string. Anything that returns a Message for a
// ModelRequest can stand in: a different provider, a router, a recorded
// fixture in a test. "Models are commodities" starts as a claim about this shape.
export interface Model {
  readonly name: string;
  complete(req: ModelRequest): Promise<Message>;
}

const client = new Anthropic();

// One concrete model: a single model id behind the interface. This is the only
// place in the harness that names a provider SDK or a model string.
export function anthropicModel(id: string): Model {
  return {
    name: id,
    complete: (req) =>
      client.messages.create({
        model: id,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
      }),
  };
}

// The SDK already retries 429 and 5xx with backoff. Reaching this catch means
// those retries were exhausted: the endpoint is down, not merely busy. Only
// then is failing over worth it, and only for errors a different endpoint
// might survive. A 400 is our bug; retrying it elsewhere just breaks twice.
// InternalServerError covers any status >= 500, which is where an overloaded
// provider (529) lands; APIConnectionError covers the network never answering.
function isOutage(err: unknown): boolean {
  return (
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  );
}

// Wrap a model so that an outage on the primary fails over to the backup.
// Composable: the backup can itself be a fallback, a router, or a model on a
// second provider. The loop never learns this happened.
export function withFallback(primary: Model, backup: Model): Model {
  return {
    name: `${primary.name}|${backup.name}`,
    async complete(req) {
      try {
        return await primary.complete(req);
      } catch (err) {
        if (!isOutage(err)) throw err;
        console.error(`# ${primary.name} is down (${String(err)}), failing over to ${backup.name}`);
        return backup.complete(req);
      }
    },
  };
}

// Route each turn to the tier that fits it. The loop decides which turns are
// hard; this only honours the decision. Routing per turn is the reason the
// model has to be a dependency: a hardcoded string cannot vary by turn.
export function router(cheap: Model, strong: Model): Model {
  return {
    name: `router(${cheap.name},${strong.name})`,
    complete: (req) => (req.hard ? strong : cheap).complete(req),
  };
}

// The harness default: Haiku for the easy turns, Sonnet for the hard ones, and
// each tier failing over to the other if its endpoint is down. Swap either id,
// or point a tier at a second provider, without touching the loop. Failing the
// strong tier down to the cheap one trades quality for availability on purpose;
// in production the backup is the same tier on a second provider, same interface.
export function defaultModel(): Model {
  const haiku = anthropicModel("claude-haiku-4-5");
  const sonnet = anthropicModel("claude-sonnet-4-6");
  return router(withFallback(haiku, sonnet), withFallback(sonnet, haiku));
}
