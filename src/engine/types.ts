export interface StructField {
  name: string;
  type: string;
  value: string;
  offset: number;
  size: number;
  changed: boolean;
}

export interface Variable {
  id: string;
  name: string;
  type: string;
  frame: string;
  kind: 'scalar' | 'array' | 'pointer' | 'struct' | 'enum' | 'heap';
  value: string;
  elements?: string[];
  length?: number;
  /** Multi-dimensional shape in row-major order (e.g. [2, 3]); absent for one-dimensional arrays. */
  shape?: number[];
  target?: string;
  targetName?: string;
  /** Present for pointers and heap objects. */
  targetLabel?: string;
  freed?: boolean;
  fields?: StructField[];
  /** Name shown instead of the bare number for enum constants. */
  enumName?: string;
  /** Byte size of the object, shown in the detail panel. */
  size?: number;
}

export interface Frame { id: string; name: string; line?: number; file?: string }

/**
 * The control-flow decision that led to this step: which branch was taken,
 * which cases were skipped, which loop round is running.
 */
export interface ControlState {
  construct: 'if' | 'switch' | 'while' | 'for' | 'do';
  line: number;
  /** Readable conclusion shown verbatim to the student. */
  result: string;
  /** Every destination of this construct; untaken ones are greyed out. */
  branches: { label: string; taken: boolean }[];
  /** Loop rounds executed so far (1-based); absent for if/switch. */
  iteration?: number;
}

export interface Snapshot {
  file?: string;
  index: number;
  line: number;
  variables: Variable[];
  frames: Frame[];
  output: string;
  changes: string[];
  description: string;
  /** Present on steps produced by a control-flow decision. */
  control?: ControlState;
  /** Present on the stop where a function returned a value. */
  returned?: { name: string; value: string };
}

export interface Trace {
  preprocessed?: { file: string; source: string }[];
  files?: Record<string, string>;
  errorFile?: string;
  source: string;
  input: string;
  snapshots: Snapshot[];
  output: string;
  status: 'completed' | 'error' | 'limited';
  error?: string;
  errorLine?: number;
  exitCode?: number;
  duration: number;
  /** Layout facts the UI can show for struct lessons. */
  layouts?: { name: string; kind: 'struct' | 'union' | 'enum'; size: number; align: number; fields: { name: string; type: string; offset: number; size: number }[]; constants?: { name: string; value: number }[] }[];
  /** What the engine can and cannot do, so the UI never overclaims. */
  platform: { bits: 64; pointerSize: 8; endian: 'little'; label: string };
  heap?: { address: number; size: number; label: string; freed: boolean }[];
}
