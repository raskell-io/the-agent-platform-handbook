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
  run: (input: Record<string, unknown>) => Promise<ToolResult>;
};
