/**
 * cochange CLI-layer defaults. Kept separate from the gate thresholds in
 * `../ranking/defaults.ts` so the registrar can import flag defaults
 * without pulling the gate's policy constants into the option-parsing
 * layer.
 */

export const DEFAULT_COCHANGE_WINDOW = 200;
export const DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT = 50;
