// Bridges the C interpreter to the teaching snapshot format used by the UI.

import { Parser, CSourceError, type Program } from './c/parse';
import { PreprocessError, preprocess } from './c/preprocess';
import { Interpreter, RuntimeError, ExitProgram, type Binding, type StepEvent } from './c/eval';
import { StdlibError } from './c/stdlib';
import {
  CHAR, INT, alignOf, isAggregate, isArray, isPointer, isRecord, layoutRecord,
  pointerTo, sizeOf, typeName,
  type ArrayType, type PointerType, type RecordType, type Type,
} from './c/types';
import type { ControlState, Frame, Snapshot, StructField, Trace, Variable } from './types';
import { prepareProject, linkPrograms, offsetLines, type SourceFiles, type SourceLocation } from './project';

const MAX_SNAPSHOTS = 1500;
const MAX_OPERATIONS = 400_000;
const MAX_OUTPUT = 16000;
const MAX_SOURCE = 32000;
const MAX_ARRAY_CELLS = 64;
const MAX_FIELDS = 24;

let parserInstance: Parser | null = null;
let treeRoot: { rootNode: any; delete(): void } | null = null;

function isNodeRuntime(): boolean {
  const globals = globalThis as { process?: { versions?: { node?: string } } };
  return Boolean(globals.process?.versions?.node);
}

function engineAssetError(file: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const looksLikeHtml = detail.includes('expected magic word') || detail.includes('WebAssembly.instantiate');
  if (looksLikeHtml) {
    return new Error(
      `引擎资源 ${file} 加载失败：服务器返回的不是 WebAssembly 文件，而是 HTML 页面。` +
        '通常是开发服务器的资源路径没有命中，请重启 `npm run dev` 后重试。',
    );
  }
  return new Error(`引擎资源 ${file} 加载失败：${detail}`);
}

async function loadGrammar(treeSitter: typeof import('web-tree-sitter')) {
  const wasmUrl = new URL('./c/tree-sitter-c.wasm', import.meta.url).href;
  try {
    if (isNodeRuntime()) {
      // Node (vitest) loads from the filesystem; browsers fetch over http.
      const filePath = decodeURIComponent(wasmUrl.startsWith('file:') ? wasmUrl.slice(7) : wasmUrl);
      return await treeSitter.Language.load(filePath);
    }
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} (${wasmUrl})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const magic = [bytes[0], bytes[1], bytes[2], bytes[3]].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    if (magic !== '00 61 73 6d') {
      throw new Error(`响应的 magic word 是 ${magic}，期望 00 61 73 6d (${wasmUrl})`);
    }
    return await treeSitter.Language.load(bytes);
  } catch (error) {
    throw engineAssetError('tree-sitter-c.wasm', error);
  }
}

type TreeSitterParser = InstanceType<typeof import('web-tree-sitter').Parser>;
let treeSitterParser: TreeSitterParser | null = null;

async function getTreeSitterParser(): Promise<TreeSitterParser> {
  if (!treeSitterParser) {
    const treeSitter = await import('web-tree-sitter');
    try {
      await treeSitter.Parser.init();
    } catch (error) {
      throw engineAssetError('web-tree-sitter.wasm', error);
    }
    const language = await loadGrammar(treeSitter);
    const parser = new treeSitter.Parser();
    parser.setLanguage(language);
    treeSitterParser = parser;
  }
  return treeSitterParser;
}

export async function runTraceAsync(source: string, input = '', files?: SourceFiles): Promise<Trace> {
  const started = performance.now();
  const trace: Trace = {
    source,
    files,
    input,
    snapshots: [],
    output: '',
    status: 'completed',
    duration: 0,
    platform: { bits: 64, pointerSize: 8, endian: 'little', label: 'x86-64 教学模型（8 字节指针、小端）' },
  };
  if (source.length > MAX_SOURCE) {
    trace.status = 'error';
    trace.error = `代码超过 ${MAX_SOURCE.toLocaleString()} 字符。请使用较小的单文件教学示例。`;
    return trace;
  }
  if (input.length > 8000) {
    trace.status = 'error';
    trace.error = '标准输入超过 8,000 字符，请缩短输入。';
    return trace;
  }

  const locations: SourceLocation[] = [];
  try {
    const treeSitter = await getTreeSitterParser();
    const parseUnit = (text: string, offset = 0): Program => {
      const tree = treeSitter.parse(text);
      if (!tree) throw new Error('解析器没有返回语法树，请简化代码后重试。');
      try {
        if (tree.rootNode.hasError) {
          const node = firstError(tree.rootNode, text);
          throw new CSourceError(`第 ${(node?.startPosition.row ?? 0) + 1} 行附近有语法错误`, (node?.startPosition.row ?? 0) + 1);
        }
        const program = new Parser(text).parse(tree.rootNode);
        offsetLines(program, offset);
        return program;
      } catch (error) {
        if (error instanceof CSourceError) throw new CSourceError(error.message, error.line + offset);
        throw error;
      } finally { tree.delete(); }
    };
    const prepared = files ? prepareProject(files) : [{ file: 'main.c', ...preprocess({ 'main.c': source }, 'main.c') }];
    if (Object.values(files ?? { 'main.c': source }).some(code => /^\s*#\s*(?:define\s+\w+(?:\([^)]*\))?[\t ]+\S|if[\t ]+|elif[\t ]+|undef[\t ]+)/m.test(code))) {
      trace.preprocessed = prepared.map(unit => ({ file: unit.file, source: unit.source }));
    }
    const units = prepared.map(unit => {
      const offset = locations.length;
      locations.push(...unit.locations);
      return { file: unit.file, program: parseUnit(unit.source, offset) };
    });
    const program = files ? linkPrograms(units) : units[0].program;
    trace.layouts = describeLayouts(program);

    const interp = new Interpreter(program, input);
    interp.onOutput = (text: string) => {
      if (trace.output.length + text.length > MAX_OUTPUT) {
        throw new RuntimeError(`输出超过 ${MAX_OUTPUT.toLocaleString()} 字符上限，程序已停止`);
      }
      trace.output += text;
    };

    let snapshots = 0;
    let operations = 0;
    let previous: Snapshot | undefined;
    const iterator = interp.run();
    for (;;) {
      if (++operations > MAX_OPERATIONS) {
        trace.status = 'limited';
        trace.error = '执行步骤超过上限，轨迹不完整。请检查循环条件。';
        break;
      }
      const next = iterator.next();
      if (next.done) break;
      const event = next.value as StepEvent;
      if (event.type === 'statement') {
        if (snapshots >= MAX_SNAPSHOTS) {
          trace.status = 'limited';
          trace.error = `轨迹达到 ${MAX_SNAPSHOTS} 步上限，后续步骤未记录。`;
          break;
        }
        const snapshot = snapshotOf(interp, event.line, trace.output, previous, { force: event.force, description: event.description });
        if (snapshot) {
          trace.snapshots.push(snapshot);
          previous = snapshot;
          snapshots++;
        }
        continue;
      }
      if (event.type === 'branch') {
        if (snapshots >= MAX_SNAPSHOTS) {
          trace.status = 'limited';
          trace.error = `轨迹达到 ${MAX_SNAPSHOTS} 步上限，后续步骤未记录。`;
          break;
        }
        const control: ControlState = {
          construct: event.construct,
          line: event.line,
          result: event.result,
          branches: event.branches,
          iteration: event.iteration,
        };
        const last = trace.snapshots[trace.snapshots.length - 1];
        if (last && last.control && sameControl(last.control, control)) continue;
        const snapshot = snapshotOf(interp, event.line, trace.output, previous, { control });
        if (snapshot) {
          trace.snapshots.push(snapshot);
          previous = snapshot;
          snapshots++;
        }
        continue;
      }
      if (event.type === 'done') {
        trace.exitCode = event.exitCode;
        break;
      }
      if (event.type === 'call') {
        // A project stop owns its frame stack. Never append a future callee to
        // the preceding source line; the next statement captures the live stack.
        if (files) continue;
        const frame: Frame = { id: event.frame.label + '@' + event.frame.depth, name: event.frame.functionName, line: event.frame.line };
        if (previous && !previous.frames.some(f => f.id === frame.id)) {
          previous.frames = [...previous.frames, frame];
          previous.description = `进入 ${frame.name}()，观察这次调用的参数与局部变量。`;
        }
      }
      if (event.type === 'return' && previous && !files) {
        previous.description = `${event.frame.functionName}() 已返回，局部变量随之结束作用域。`;
      }
    }
    trace.output = interp.outputText;
    if (trace.status === 'completed') {
      const last = trace.snapshots.at(-1);
      if (last) {
        last.output = trace.output;
        if (trace.output && last.output === trace.output) {
          last.description = trace.exitCode === 0 ? `程序结束，返回 ${trace.exitCode}。` : last.description;
        }
      }
    }
  } catch (error) {
    trace.status = 'error';
    if (error instanceof PreprocessError) {
      trace.error = error.message;
      trace.errorFile = error.file;
      trace.errorLine = error.line;
    } else if (error instanceof CSourceError) {
      trace.error = error.message;
      trace.errorLine = error.line;
    } else if (error instanceof RuntimeError) {
      trace.error = error.line ? `第 ${error.line} 行：${error.message}` : error.message;
      trace.errorLine = error.line || undefined;
    } else if (error instanceof StdlibError) {
      trace.error = error.message;
    } else if (error instanceof ExitProgram) {
      trace.exitCode = error.code;
    } else {
      trace.error = error instanceof Error ? error.message : String(error);
    }
  }
  trace.heap = undefined;
  if (locations.length) {
    const locate = (line?: number) => line ? locations[line - 1] : undefined;
    for (const snapshot of trace.snapshots) {
      const location = locate(snapshot.line);
      if (location) { if (files) snapshot.file = location.file; snapshot.line = location.line; }
      if (snapshot.control) snapshot.control.line = locate(snapshot.control.line)?.line ?? snapshot.control.line;
      // Frames may be shared between snapshots; map copies rather than mutating aliases.
      snapshot.frames = snapshot.frames.map(frame => ({ ...frame, ...locate(frame.line) }));
    }
    const errorLocation = trace.errorFile ? undefined : locate(trace.errorLine);
    if (errorLocation) {
      trace.errorFile = errorLocation.file;
      trace.errorLine = errorLocation.line;
      trace.error = `${errorLocation.file}:${errorLocation.line}：${trace.error?.replace(/第 \d+ 行(?:附近|：)?/g, '')}`;
    }
  }
  trace.duration = Math.round(performance.now() - started);
  return trace;
}

function firstError(node: any, source: string): any | undefined {
  if (node.hasError && node.type === 'ERROR') return node;
  for (let i = 0; i < node.childCount; i++) {
    const found = firstError(node.child(i), source);
    if (found) return found;
  }
  return node.hasError ? node : undefined;
}

function describeLayouts(program: Program): Trace['layouts'] {
  const seen = new Set<string>();
  const layouts: NonNullable<Trace['layouts']> = [];
  for (const tag of program.tags) {
    const key = `${tag.kind} ${tag.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tag.kind === 'struct' && tag.type.kind === 'record') {
      const laid = layoutRecord(tag.type);
      layouts.push({
        name: tag.name || '匿名结构体',
        kind: 'struct',
        size: laid.size,
        align: alignOf(tag.type),
        fields: laid.fields.map(field => ({ name: field.name, type: typeName(field.type), offset: field.offset, size: sizeOf(field.type) })),
      });
      continue;
    }
    if (tag.type.kind === 'enum') {
      layouts.push({
        name: tag.name || '匿名枚举',
        kind: 'enum',
        size: sizeOf(tag.type),
        align: alignOf(tag.type),
        fields: [],
        constants: Object.entries((tag.type as { enumerators?: Record<string, number> }).enumerators ?? {}).map(([name, value]) => ({ name, value })),
      });
    }
  }
  return layouts;
}

/** Two control decisions are the same step when nothing about them differs. */
function sameControl(a: ControlState, b: ControlState): boolean {
  return a.line === b.line && a.result === b.result && a.iteration === b.iteration
    && a.branches.length === b.branches.length
    && a.branches.every((branch, index) => branch.label === b.branches[index].label && branch.taken === b.branches[index].taken);
}

/**
 * Build the snapshot for a stop. A control-flow decision always produces a step,
 * even when no variable changed: condition checks are what students need to see.
 */
function snapshotOf(
  interp: Interpreter,
  line: number,
  output: string,
  previous: Snapshot | undefined,
  options: { control?: ControlState; force?: boolean; description?: string } = {},
): Snapshot | undefined {
  const { control, force, description } = options;
  const variables = interp.bindings.map(binding => describeBinding(interp, binding, previous));
  const frames: Frame[] = interp.frames.map(frame => ({ id: `${frame.functionName}@${frame.depth}`, name: frame.functionName, line: frame.line }));
  const changes = variables.filter(variable => {
    const before = previous?.variables.find(old => old.id === variable.id);
    return !before || before.value !== variable.value || fieldsChanged(variable, before);
  }).map(variable => variable.id);
  const framesChanged = JSON.stringify(frames) !== JSON.stringify(previous?.frames ?? []);
  const outputChanged = output !== previous?.output;
  if (!control && !force) {
    if (previous && previous.line === line && changes.length === 0 && !framesChanged && previous.output === output) return undefined;
    if (previous && changes.length === 0 && !framesChanged && !outputChanged) return undefined;
  }
  return {
    index: previous ? previous.index + 1 : 0,
    line,
    variables,
    frames,
    output,
    changes,
    description: control ? control.result : description ?? describe(interp, variables, changes, framesChanged, previous, outputChanged),
    control,
  };
}

function fieldsChanged(variable: Variable, before: Variable | undefined): boolean {
  const now = variable.fields;
  const was = fieldsOf(before);
  if (!now || now.length !== was.length) return false;
  return now.some((field, index) => field.value !== was[index]?.value);
}

function fieldsOf(before: Variable | undefined): StructField[] {
  return before?.fields ?? [];
}

function describe(
  interp: Interpreter,
  variables: Variable[],
  changes: string[],
  framesChanged: boolean,
  previous: Snapshot | undefined,
  outputChanged: boolean,
): string {
  const parts: string[] = [];
  for (const id of changes.slice(0, 3)) {
    const variable = variables.find(item => item.id === id)!;
    const before = previous?.variables.find(item => item.id === id);
    if (!before) {
      parts.push(`${describeNew(variable)}`);
      continue;
    }
    const prior = fieldsOf(before);
    const fieldChange = variable.fields?.find((field, index) => field.value !== prior[index]?.value);
    if (fieldChange) parts.push(`${variable.name}.${fieldChange.name}：${before.value} → ${fieldChange.value}`);
    else parts.push(`${variable.name}：${before.value} → ${variable.value}`);
  }
  if (!parts.length && framesChanged) {
    const entered = interp.frames.at(-1);
    if (entered) parts.push(`进入 ${entered.functionName}()，观察这次调用的参数与局部变量。`);
  }
  if (!parts.length && outputChanged) parts.push('程序产生了新的标准输出。');
  if (!parts.length) return `停在第 ${interp.lastLineNumber} 行，状态没有变化。`;
  return parts.join('；');
}

function describeNew(variable: Variable): string {
  if (variable.kind === 'heap') return `堆上分配了 ${variable.size} 字节`;
  if (variable.kind === 'enum' && variable.enumName) return `${variable.name} = ${variable.enumName}`;
  return `${variable.name} = ${variable.value}`;
}

function describeBinding(interp: Interpreter, binding: Binding, previous?: Snapshot): Variable {
  const id = bindingId(binding);
  const before = previous?.variables.find(old => old.id === id);
  const base: Variable = {
    id,
    name: binding.name,
    type: typeName(binding.type),
    frame: binding.frame,
    kind: binding.kind === 'heap' ? 'heap' : scalarKind(binding.type),
    value: '',
    size: Math.max(1, sizeOf(binding.type)),
  };
  if (binding.kind === 'heap' && interp.isFreed(binding.address)) {
    return { ...base, value: '已释放', freed: true, targetLabel: '内存已归还，读取它属于未定义行为' };
  }
  if (isRecord(binding.type)) {
    const fields = recordFields(interp, binding.address, binding.type, before);
    const summary = fields.filter(field => isScalarField(field)).map(field => `${field.name}=${field.value}`).join(' ');
    return { ...base, kind: 'struct', value: summary || '{ … }', fields };
  }
  if (isArray(binding.type)) {
    const type: ArrayType = binding.type;
    const elements: string[] = [];
    for (let index = 0; index < Math.min(type.count, MAX_ARRAY_CELLS); index++) {
      elements.push(scalarText(interp, binding.address + index * sizeOf(type.of), type.of));
    }
    const display = `[${elements.join(', ')}${type.count > MAX_ARRAY_CELLS ? ', …' : ''}]`;
    return { ...base, kind: 'array', value: display, elements, length: type.count };
  }
  if (isPointer(binding.type)) {
    const pointerType: PointerType = binding.type;
    const value = interp.memory.readValue(binding.address, INT).value;
    const target = resolveTarget(interp, binding, value, pointerType);
    return {
      ...base,
      kind: binding.kind === 'heap' ? 'heap' : 'pointer',
      value: target ? `→ ${target.name}` : (value === 0 ? '空指针 NULL' : '→ 未解析对象'),
      target: target?.id,
      targetName: target?.name,
      targetLabel: target ? target.detail : (value === 0 ? '不指向任何对象' : `本次运行中找不到指向的对象（数值 ${value}）`),
    };
  }
  if (binding.type.kind === 'enum') {
    const value = interp.memory.readValue(binding.address, INT).value;
    const names = [...interp.enumNames.entries()].filter(([, info]) => info.value === value).map(([name]) => name);
    return {
      ...base,
      kind: 'enum',
      value: `${value}`,
      enumName: names.length ? names.join(' / ') : undefined,
      targetLabel: names.length ? `枚举常量：${names.join(' / ')}` : '这个数值不对应本文件中的枚举常量',
    };
  }
  return { ...base, value: scalarText(interp, binding.address, binding.type) };
}

function scalarKind(type: Type): Variable['kind'] {
  if (isRecord(type)) return 'struct';
  if (type.kind === 'enum') return 'enum';
  if (isArray(type)) return 'array';
  if (isPointer(type)) return 'pointer';
  return 'scalar';
}

function isScalarField(field: StructField): boolean {
  return !field.value.startsWith('{');
}

function recordFields(interp: Interpreter, address: number, type: RecordType, before?: Variable): StructField[] {
  const laid = layoutRecord(type);
  const fields: StructField[] = [];
  for (const field of laid.fields.slice(0, MAX_FIELDS)) {
    const fieldAddress = address + field.offset;
    let value: string;
    if (isRecord(field.type)) value = '{ … }';
    else if (isArray(field.type)) {
      const arrayType: ArrayType = field.type;
      const items: string[] = [];
      for (let i = 0; i < Math.min(arrayType.count, 8); i++) items.push(scalarText(interp, fieldAddress + i * sizeOf(arrayType.of), arrayType.of));
      value = `[${items.join(', ')}${arrayType.count > 8 ? ', …' : ''}]`;
    } else value = scalarText(interp, fieldAddress, field.type);
    const previousField = fieldsOf(before).find(item => item.name === field.name);
    fields.push({
      name: field.name,
      type: typeName(field.type),
      value,
      offset: field.offset,
      size: Math.max(1, sizeOf(field.type)),
      changed: previousField ? previousField.value !== value : false,
    });
  }
  return fields;
}

function scalarText(interp: Interpreter, address: number, type: Type): string {
  if (isAggregate(type)) return '…';
  if (type.kind === 'int' && type.bits === 8) {
    const value = interp.memory.readValue(address, type).value;
    if (value === 0) return '\\0';
    if (value === 10) return '\\n';
    if (value >= 32 && value < 127) return `'${String.fromCharCode(value)}'`;
    return String(value);
  }
  return String(interp.memory.readValue(address, type).value);
}

const bindingId = (binding: Binding): string => `${binding.name}@${binding.frame}@${binding.address.toString(16)}`;

function resolveTarget(
  interp: Interpreter,
  binding: Binding,
  value: number,
  pointerType: Extract<Type, { kind: 'pointer' }>,
): { id: string; name: string; detail: string } | undefined {
  if (value === 0) return undefined;
  const pointee = pointerType.to;
  if (pointee.kind === 'function') {
    const name = interp.functionNameAt(value);
    return name ? { id: `fn:${name}`, name: `${name}()`, detail: `指向函数 ${name}()` } : undefined;
  }
  if (isArray(pointee)) {
    const owner = interp.bindings.find(item => isArray(item.type) && item.address <= value && value < item.address + Math.max(1, sizeOf(item.type)));
    if (owner && isArray(owner.type)) {
      const index = Math.floor((value - owner.address) / Math.max(1, sizeOf(owner.type.of)));
      return { id: bindingId(owner), name: `${owner.name}[${index}]`, detail: `指向 ${owner.name} 的第 ${index} 个元素` };
    }
  }
  const owner = interp.bindings.find(item =>
    item.address !== binding.address && item.address <= value && value < item.address + Math.max(1, sizeOf(item.type)));
  if (owner) {
    return { id: bindingId(owner), name: owner.name, detail: `指向变量 ${owner.name}（${typeName(owner.type)}）` };
  }
  const live = interp.memory.liveObjects().find(item => item.address <= value && value < item.address + item.size);
  if (live) {
    return { id: `heap:${live.address.toString(16)}`, name: `${live.label}`, detail: `指向堆上 ${live.size} 字节的对象（${live.label}）` };
  }
  return undefined;
}

export { CHAR, INT, pointerTo };
