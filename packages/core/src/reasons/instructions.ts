import type { InstructionScope } from '../instructions.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** A JSON instruction version does not parse (or is not an object); the layer is skipped. */
    instruction_json_invalid: { fileKey: string; scope: InstructionScope; version: number };
    /** A JSON field has a different type than below; the value from the layer below applies. */
    instruction_field_invalid: {
      fileKey: string;
      scope: InstructionScope;
      version: number;
      field: string;
    };
  }
}
