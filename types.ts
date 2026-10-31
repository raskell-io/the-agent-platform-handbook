export type ToolResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type Tool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  max_output_bytes?: number;
  // A call to this tool waits for a person to approve it (post-11). The run
  // stops, durably, and resumes from its journal once someone has decided.
  approval?: boolean;
  // How long one call may take before it counts as failed (post-11).
  timeout_ms?: number;
  run: (input: Record<string, unknown>) => Promise<ToolResult>;
};
