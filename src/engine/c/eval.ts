// Step-wise evaluator for the teaching C subset. Control flow uses JS
// generators: every `yield` is a place where the UI can stop, so each stop is a
// real interpreter state rather than a replayed approximation.

import {
  Memory, copyAggregate, isAggregateValue,
  type AggregateValue, type ScalarValue,
} from './memory';
import {
  CHAR, DOUBLE, INT, LONG, VOID, fieldOffsets, findField, integerRange, isAggregate, isArray,
  isArithmetic, isFloating, isInteger, isPointer, isRecord, isScalar, isUnion, layoutRecord,
  pointerTo, promote, sizeOf, typeName, usualArithmetic, wrapInteger,
  type Param, type Type,
} from './types';
import type { BinaryOp, Declaration, Expression, Initializer, Program, Statement } from './parse';
import { callNative, isNative } from './stdlib';

export interface Binding {
  unit?: string;
  internal?: boolean;
  name: string;
  type: Type;
  address: number;
  /** Frame label such as `main` or `sort`. */
  frame: string;
  kind: 'local' | 'parameter' | 'global' | 'heap';
  /** Set for heap objects so the UI can show allocation lifetime. */
  allocationEnd?: number;
}

export interface CallFrame {
  label: string;
  functionName: string;
  line: number;
  depth: number;
}

export type StepEvent =
  | {
      type: 'statement';
      line: number;
      /** Always produce a stop even when nothing observable changed. */
      force?: boolean;
      /** Ready-made explanation for control transfer, where nothing changes. */
      description?: string;
    }
  | {
      type: 'branch';
      construct: 'if' | 'switch' | 'while' | 'for' | 'do';
      line: number;
      /** 学生直接可读的结论，例如「条件不成立，执行 else 分支」。 */
      result: string;
      /** 该构造的全部去向；未走的那条 `taken` 为 false，界面置灰。 */
      branches: { label: string; taken: boolean }[];
      /** 循环已执行的轮数，从 1 开始；if 与 switch 为 undefined。 */
      iteration?: number;
    }
  | { type: 'call'; frame: CallFrame }
  | { type: 'return'; frame: CallFrame }
  | { type: 'allocate'; address: number; size: number; label: string }
  | { type: 'free'; address: number; label: string }
  | { type: 'done'; exitCode: number };

export class RuntimeError extends Error {
  constructor(message: string, readonly line = 0) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export class ExitProgram extends Error {
  constructor(readonly code: number) {
    super('程序退出');
    this.name = 'ExitProgram';
  }
}

type Flow = { signal: 'break' | 'continue' | 'return'; value?: Value };
type Value = ScalarValue | AggregateValue;

const MAX_DEPTH = 64;

/** Statements that get their own stop once they have run. */
const STOP_KINDS = new Set<Statement['kind']>(['ExprStmt', 'DeclStmt', 'Break', 'Continue', 'Return']);
/** Control-transfer statements stop even when no variable changed. */
const FORCED_STOP_KINDS = new Set<Statement['kind']>(['Break', 'Continue', 'Return']);
const MAX_STEPS = 600_000;
const FRAME_SLOTS = 512;

interface FunctionEntry {
  unit?: string;
  name: string;
  type: Extract<Type, { kind: 'function' }>;
  body?: Statement;
  /** Synthetic address used when the function is used as a value. */
  address: number;
}

export class Interpreter {
  randomSeed = 1;
  readonly memory = new Memory();
  readonly bindings: Binding[] = [];
  readonly frames: CallFrame[] = [];
  readonly enumNames = new Map<string, { enumName: string; value: number }>();

  private functions = new Map<string, FunctionEntry>();
  private functionByAddress = new Map<number, FunctionEntry>();
  private typedefs = new Map<string, Type>();
  private stringPool = new Map<string, number>();
  private nextFunctionAddress = 0x1000;
  private output = '';
  /** Called for every piece of standard output, so the trace can show it step by step. */
  onOutput?: (text: string) => void;
  private steps = 0;
  private inputCursor = 0;
  private lastLine = 0;
  private currentUnit?: string;
  private localStart = 0;
  private staticLocals = new Map<Declaration, number>();
  private visible = new Map<string, Set<string>>();

  constructor(private readonly program: Program, private readonly input: string) {
    for (const tag of program.tags) {
      if (tag.type.kind !== 'enum') continue;
      const enumerators = (tag.type as { enumerators?: Record<string, number> }).enumerators ?? {};
      for (const [name, value] of Object.entries(enumerators)) {
        this.enumNames.set(name, { enumName: tag.name || '匿名枚举', value });
      }
    }
    for (const decl of program.decls) {
      const unit = program.units?.get(decl);
      if (unit) {
        if (!this.visible.has(unit)) this.visible.set(unit, new Set());
        this.visible.get(unit)!.add(decl.name);
      }
      if (decl.kind === 'TypeDecl') { this.typedefs.set(decl.name, decl.type); continue; }
      if (decl.kind === 'FuncDecl') {
        const key = decl.storage === 'static' && unit ? `${unit}:${decl.name}` : decl.name;
        const prior = this.functions.get(key);
        if (prior?.body && !decl.body) continue;
        const address = this.nextFunctionAddress++;
        const entry: FunctionEntry = { name: decl.name, type: decl.type, body: decl.body, address, unit };
        this.functions.set(key, entry);
        this.functionByAddress.set(address, entry);
      }
    }
  }

  get outputText(): string { return this.output }
  get lastLineNumber(): number { return this.lastLine }

  *run(): Generator<StepEvent, void, void> {
    for (const decl of this.program.decls) {
      if (decl.kind !== 'VarDecl' || decl.storage === 'extern' && !decl.init) continue;
      this.currentUnit = this.program.units?.get(decl);
      const size = Math.max(1, sizeOf(decl.type));
      const address = this.memory.allocStatic(size, decl.name);
      this.bindings.push({ name: decl.name, type: decl.type, address, frame: this.currentUnit ? `全局 · ${this.currentUnit}` : '全局', kind: 'global', unit: this.currentUnit, internal: decl.storage === 'static' });
      if (decl.init) yield* this.initialize(address, decl.type, decl.init, decl.line);
    }
    const main = this.functions.get('main');
    if (!main?.body) throw new RuntimeError('找不到带函数体的 main');
    const returned = yield* this.invokeUser(main, [], 0);
    const exitCode = isAggregateValue(returned) || typeof returned.value !== 'number' ? 0 : returned.value;
    yield { type: 'done', exitCode };
  }

  /* ---------- Statements ---------- */

  private *execBlock(node: Extract<Statement, { kind: 'Block' }>, depth: number): Generator<StepEvent, Flow | undefined, void> {
    const marker = this.bindings.length;
    try {
      for (const statement of node.body) {
        const flow = yield* this.execStatement(statement, depth);
        if (flow) return flow;
      }
      return undefined;
    } finally {
      // Leaving a block ends the lifetime of the variables it introduced.
      this.bindings.length = marker;
    }
  }

  /**
   * Run one statement and stop on the state it produced, attributed to its own
   * line. A stop is emitted after the statement runs, so a change and the line
   * that caused it are always shown together. Control-flow constructs report
   * through `branch` events instead, and blocks report through their children.
   */
  private *execStatement(node: Statement, depth: number): Generator<StepEvent, Flow | undefined, void> {
    this.steps++;
    if (this.steps > MAX_STEPS) throw new RuntimeError('执行步数超过上限，可能存在无法结束的循环', node.line);
    this.lastLine = node.line;
    const flow = yield* this.executeStatement(node, depth);
    if (STOP_KINDS.has(node.kind)) {
      yield {
        type: 'statement',
        line: node.line,
        force: FORCED_STOP_KINDS.has(node.kind),
        description: node.kind === 'Break'
          ? 'break 生效：直接离开当前的 switch 或循环，继续执行它后面的语句。'
          : node.kind === 'Continue'
            ? 'continue 生效：跳过本轮剩余语句，回到循环条件重新判断。'
            : undefined,
      };
    }
    return flow;
  }

  private *executeStatement(node: Statement, depth: number): Generator<StepEvent, Flow | undefined, void> {
    switch (node.kind) {
      case 'Block': return yield* this.execBlock(node, depth);
      case 'Empty': return undefined;
      case 'ExprStmt':
        yield* this.eval(node.expr, depth);
        return undefined;
      case 'DeclStmt':
        for (const decl of node.decls) yield* this.execDeclaration(decl, depth);
        return undefined;
      case 'If': {
        const condition = this.scalarOf(yield* this.eval(node.cond, depth), node.line);
        const taken = condition.value !== 0;
        const branches = [{ label: 'if 分支', taken }];
        if (node.otherwise) branches.push({ label: 'else 分支', taken: !taken });
        yield {
          type: 'branch',
          construct: 'if',
          line: node.line,
          result: taken
            ? '条件成立，执行 if 分支。'
            : node.otherwise
              ? '条件不成立，执行 else 分支。'
              : '条件不成立，跳过 if 分支。',
          branches,
        };
        if (taken) return yield* this.execStatement(node.then, depth);
        if (node.otherwise) return yield* this.execStatement(node.otherwise, depth);
        return undefined;
      }
      case 'While':
      case 'For':
      case 'DoWhile':
        return yield* this.runLoop(node, depth);
      case 'Break': return { signal: 'break' };
      case 'Continue': return { signal: 'continue' };
      case 'Return': {
        if (!node.value) return { signal: 'return', value: { type: INT, value: 0 } };
        return { signal: 'return', value: yield* this.eval(node.value, depth) };
      }
      case 'Switch': return yield* this.runSwitch(node, depth);
      case 'Label':
      case 'Goto':
        throw new RuntimeError(`暂不支持 ${node.kind === 'Goto' ? 'goto' : '标签'} 语句`, node.line);
      default:
        throw new RuntimeError(`未处理的语句 ${(node as Statement).kind}`, node.line);
    }
  }

  private *runLoop(node: Statement, depth: number): Generator<StepEvent, Flow | undefined, void> {
    if (node.kind === 'For' && node.init) yield* this.execStatement(node.init, depth);
    const condition = node.kind === 'While' || node.kind === 'For' || node.kind === 'DoWhile' ? node.cond : undefined;
    const update = node.kind === 'For' ? node.update : undefined;
    const body = node.kind === 'While' || node.kind === 'For' || node.kind === 'DoWhile' ? node.body : undefined;
    const construct = node.kind === 'For' ? 'for' : node.kind === 'DoWhile' ? 'do' : 'while';
    let firstIteration = true;
    let iteration = 0;
    while (true) {
      if (!(node.kind === 'DoWhile' && firstIteration)) {
        if (condition) {
          const test = this.scalarOf(yield* this.eval(condition, depth), node.line);
          if (test.value === 0) {
            yield {
              type: 'branch',
              construct,
              line: node.line,
              result: iteration === 0 ? '条件不成立，一次都不进入循环。' : `条件不成立，结束循环（已执行 ${iteration} 轮）。`,
              branches: [{ label: '循环体', taken: false }, { label: '循环之后', taken: true }],
              iteration,
            };
            return undefined;
          }
          yield {
            type: 'branch',
            construct,
            line: node.line,
            result: `条件成立，进入第 ${iteration + 1} 轮循环。`,
            branches: [{ label: '循环体', taken: true }, { label: '循环之后', taken: false }],
            iteration: iteration + 1,
          };
        }
      }
      firstIteration = false;
      iteration++;
      const flow = yield* this.execStatement(body!, depth);
      if (flow?.signal === 'return') return flow;
      if (flow?.signal === 'break') return undefined;
      if (update) yield* this.eval(update, depth);
    }
  }

  private *runSwitch(node: Extract<Statement, { kind: 'Switch' }>, depth: number): Generator<StepEvent, Flow | undefined, void> {
    const subject = this.scalarOf(yield* this.eval(node.subject, depth), node.line);
    const target = wrapInteger(subject.value, INT);
    const body = node.body.body;
    let startIndex = -1;
    let defaultIndex = -1;
    const labels: string[] = [];
    for (let i = 0; i < body.length; i++) {
      const statement = body[i];
      if (statement.kind === 'Default') {
        if (defaultIndex < 0) defaultIndex = i;
        labels[i] = 'default';
        continue;
      }
      if (statement.kind !== 'Case') { labels[i] = ''; continue; }
      if (!statement.value) { labels[i] = 'case'; continue; }
      const value = this.scalarOf(yield* this.eval(statement.value, depth), node.line);
      labels[i] = `case ${value.value}`;
      if (startIndex < 0 && wrapInteger(value.value, INT) === target) startIndex = i;
    }
    const hit = startIndex >= 0 ? startIndex : defaultIndex;
    const branches = labels.map((label, i) => ({ label, taken: i === hit })).filter(branch => branch.label);
    yield {
      type: 'branch',
      construct: 'switch',
      line: node.line,
      result: hit < 0
        ? `switch(${target}) 没有匹配的 case，跳过整个 switch。`
        : labels[hit] === 'default'
          ? `switch(${target}) 没有匹配的 case，执行 default。`
          : `switch(${target}) 命中 ${labels[hit]}，从这里开始执行。`,
      branches,
    };
    if (hit < 0) return undefined;
    for (let i = hit; i < body.length; i++) {
      const statement = body[i];
      const inner = statement.kind === 'Case' || statement.kind === 'Default' ? statement.body : [statement];
      for (const item of inner) {
        const flow = yield* this.execStatement(item, depth);
        if (flow?.signal === 'break') return undefined;
        if (flow) return flow;
      }
    }
    return undefined;
  }

  private *execDeclaration(decl: Declaration, depth: number): Generator<StepEvent, void, void> {
    if (decl.kind === 'TypeDecl') { this.typedefs.set(decl.name, decl.type); return; }
    if (decl.kind === 'FuncDecl') return;
    if (decl.storage === 'extern') {
      const binding = this.bindings.find(item => item.kind === 'global' && item.name === decl.name && (!item.internal || item.unit === this.currentUnit));
      if (!binding || decl.init) throw new RuntimeError(`extern 声明 ${decl.name} 无法连接到全局定义`, decl.line);
      this.bindings.push({ ...binding, kind: 'local', frame: this.currentFrame() });
      return;
    }
    const size = Math.max(1, sizeOf(decl.type));
    if (decl.storage === 'static') {
      let address = this.staticLocals.get(decl);
      const first = address === undefined;
      if (first) {
        address = this.memory.allocStatic(size, decl.name);
        this.memory.zero(address, size);
        this.staticLocals.set(decl, address);
      }
      this.bindings.push({ name: decl.name, type: decl.type, address: address!, frame: `${this.currentFrame()} · static`, kind: 'local' });
      if (first && decl.init) yield* this.initialize(address!, decl.type, decl.init, decl.line);
      return;
    }
    const address = this.memory.allocStack(size, decl.name);
    this.bindings.push({ name: decl.name, type: decl.type, address, frame: this.currentFrame(), kind: 'local' });
    if (decl.init) yield* this.initialize(address, decl.type, decl.init, decl.line);
  }

  private currentFrame(): string {
    return this.frames.at(-1)?.functionName ?? '全局';
  }

  /* ---------- Initialization ---------- */

  private *initialize(address: number, type: Type, init: Initializer, line: number): Generator<StepEvent, void, void> {
    if (init.kind === 'Designated') {
      if (isRecord(type)) {
        const field = findField(type, init.field);
        if (!field) throw new RuntimeError(`结构体没有字段 '${init.field}'`, line);
        yield* this.initialize(address + field.offset, field.type, init.value, line);
        return;
      }
      if (isArray(type) && init.index !== undefined) {
        yield* this.initialize(address + init.index * sizeOf(type.of), type.of, init.value, line);
        return;
      }
      throw new RuntimeError('这个初始化项不能用于当前类型', line);
    }
    if (init.kind === 'Expr') {
      if (init.expr.kind === 'Str') {
        if (isPointer(type)) {
          this.memory.writeValue(address, type, { type, value: this.internString(init.expr.bytes) });
          return;
        }
        if (isArray(type) && type.of.kind === 'int' && type.of.bits === 8) {
          this.memory.writeBytes(address, Uint8Array.from(init.expr.bytes.map(byte => byte & 0xff)));
          return;
        }
      }
      const value = yield* this.eval(init.expr, this.frames.length);
      this.writeAt(address, type, this.decay(value, type, line), line);
      return;
    }
    if (init.kind !== 'List') throw new RuntimeError('无法识别的初始化项', line);
    if (!isAggregate(type)) {
      const first = init.items[0];
      if (first) yield* this.initialize(address, type, first, line);
      return;
    }
    this.memory.zero(address, Math.max(1, sizeOf(type)));
    if (isArray(type)) {
      let cursor = 0;
      for (const item of init.items) {
        if (item.kind === 'Expr' && item.expr.kind === 'Str') {
          const pool = this.internString(item.expr.bytes);
          this.copyCString(pool, address + cursor);
          cursor += item.expr.bytes.length;
          continue;
        }
        if (item.kind === 'Designated' && item.index !== undefined) {
          yield* this.initialize(address + item.index * sizeOf(type.of), type.of, item.value, line);
          cursor = item.index + 1;
          continue;
        }
        if (cursor >= type.count) break;
        yield* this.initialize(address + cursor * sizeOf(type.of), type.of, item, line);
        cursor += 1;
      }
      return;
    }
    // struct / union: positional entries fill fields in declaration order.
    const fields = layoutRecord(type).fields;
    for (const field of fields) this.memory.zero(address + field.offset, Math.max(1, sizeOf(field.type)));
    let position = 0;
    for (const item of init.items) {
      if (item.kind === 'Designated') {
        const field = findField(type, item.field);
        if (!field) throw new RuntimeError(`结构体没有字段 '${item.field}'`, line);
        yield* this.initialize(address + field.offset, field.type, item.value, line);
        position = fields.indexOf(field) + 1;
        continue;
      }
      const field = fields[position];
      if (!field) break;
      if (isUnion(type)) position = 0; else position += 1;
      yield* this.initialize(address + field.offset, field.type, item, line);
    }
  }

  private internString(bytes: number[]): number {
    const key = bytes.join(',');
    const existing = this.stringPool.get(key);
    if (existing !== undefined) return existing;
    const address = this.memory.allocStatic(Math.max(1, bytes.length), '字符串常量');
    this.memory.writeBytes(address, Uint8Array.from(bytes.map(byte => byte & 0xff)));
    this.stringPool.set(key, address);
    return address;
  }

  private copyCString(from: number, to: number): void {
    for (let offset = 0; offset < 4096; offset++) {
      const byte = this.memory.readBytes(from + offset, 1)[0];
      this.memory.writeBytes(to + offset, Uint8Array.of(byte));
      if (byte === 0) return;
    }
  }

  /* ---------- Expressions ---------- */

  private *eval(node: Expression, depth: number): Generator<StepEvent, Value, void> {
    this.steps++;
    if (this.steps > MAX_STEPS) throw new RuntimeError('执行步数超过上限，可能存在无法结束的循环', node.line);
    switch (node.kind) {
      case 'Num': return { type: node.type, value: node.value };
      case 'Char': return { type: INT, value: node.value };
      case 'Str': return { type: pointerTo(CHAR), value: this.internString(node.bytes) };

      case 'Var': {
        // A function name used on its own means a pointer to that function.
        const entry = this.findFunction(node.name);
        if (entry && !this.hasBinding(node.name)) return { type: pointerTo(entry.type), value: entry.address };
        const binding = this.lookup(node.name);
        if (isAggregate(binding.type)) return { kind: 'aggregate', type: binding.type, address: binding.address };
        if (binding.type.kind === 'function') return { type: pointerTo(binding.type), value: binding.address };
        return this.memory.readValue(binding.address, binding.type);
      }


      case 'Assign': {
        const value = yield* this.eval(node.value, depth);
        if (node.op === '=') return yield* this.store(node.target, value, depth);
        const current = yield* this.eval(node.target, depth);
        const combined = this.binary(node.op.slice(0, -1) as BinaryOp, current, value, node.line);
        return yield* this.store(node.target, combined, depth);
      }

      case 'Binary': {
        if (node.op === '&&' || node.op === '||') {
          const left = this.scalarOf(yield* this.eval(node.left, depth), node.line);
          if (node.op === '&&' && left.value === 0) return { type: INT, value: 0 };
          if (node.op === '||' && left.value !== 0) return { type: INT, value: 1 };
          const right = this.scalarOf(yield* this.eval(node.right, depth), node.line);
          return { type: INT, value: right.value !== 0 ? 1 : 0 };
        }
        const left = yield* this.eval(node.left, depth);
        const right = yield* this.eval(node.right, depth);
        return this.binary(node.op, left, right, node.line);
      }

      case 'Unary': {
        if (node.op === '&') return yield* this.addressOf(node.operand, depth);
        if (node.op === '*') {
          const pointer = this.scalarOf(yield* this.eval(node.operand, depth), node.line);
          const pointee = isPointer(pointer.type) ? pointer.type.to : INT;
          if (pointer.value === 0) throw new RuntimeError('解引用了空指针', node.line);
          if (isAggregate(pointee)) return { kind: 'aggregate', type: pointee, address: pointer.value };
          return this.memory.readValue(pointer.value, pointee);
        }
        const operand = this.scalarOf(yield* this.eval(node.operand, depth), node.line);
        const promoted = promote(operand.type);
        switch (node.op) {
          case '-': return { type: promoted, value: wrapInteger(-operand.value, promoted) };
          case '+': return { type: promoted, value: operand.value };
          case '!': return { type: INT, value: operand.value === 0 ? 1 : 0 };
          case '~': return { type: promoted, value: wrapInteger(~operand.value, promoted) };
          default: throw new RuntimeError(`未处理的一元运算符 ${node.op}`, node.line);
        }
      }

      case 'IncDec': {
        const before = this.scalarOf(yield* this.eval(node.operand, depth), node.line);
        const after = this.scalarOf(this.binary(node.op === '++' ? '+' : '-', before, { type: INT, value: 1 }, node.line), node.line);
        yield* this.store(node.operand, after, depth);
        return node.prefix ? after : before;
      }

      case 'Ternary': {
        const cond = this.scalarOf(yield* this.eval(node.cond, depth), node.line);
        return cond.value !== 0 ? yield* this.eval(node.then, depth) : yield* this.eval(node.otherwise, depth);
      }

      case 'Comma':
        yield* this.eval(node.left, depth);
        return yield* this.eval(node.right, depth);

      case 'Call': return yield* this.call(node, depth);
      case 'Index': {
        const { address, elementType } = yield* this.elementAddress(node, depth);
        if (isAggregate(elementType)) return { kind: 'aggregate', type: elementType, address };
        return this.memory.readValue(address, elementType);
      }
      case 'Member': {
        const holder = yield* this.memberHolder(node, depth);
        return this.readField(holder.address, holder.type, node.field, node.line);
      }
      case 'Cast': {
        const value = yield* this.eval(node.operand, depth);
        return this.cast(value, node.to, node.line);
      }
      case 'SizeofType': return { type: LONG, value: sizeOf(node.type) };
      case 'SizeofExpr': {
        if (node.operand.kind === 'Var') {
          const name = node.operand.name;
          if (!this.hasBinding(name)) {
            const alias = this.program.decls.find(decl => decl.kind === 'TypeDecl' && decl.name === name);
            if (alias) return { type: LONG, value: sizeOf(alias.type) };
          }
        }
        const value = yield* this.eval(node.operand, depth);
        return { type: LONG, value: sizeOf(value.type) };
      }
      default:
        throw new RuntimeError(`未处理的表达式 ${(node as Expression).kind}`, (node as Expression).line);
    }
  }

  private *elementAddress(node: Extract<Expression, { kind: 'Index' }>, depth: number): Generator<StepEvent, { address: number; elementType: Type }, void> {
    const base = yield* this.eval(node.base, depth);
    const index = this.scalarOf(yield* this.eval(node.index, depth), node.line);
    if (!isInteger(index.type)) throw new RuntimeError('数组下标必须是整数', node.line);

    // An array or struct variable decays to its address for indexing.
    if (isAggregateValue(base)) {
      if (!isArray(base.type)) throw new RuntimeError('只能对数组使用下标', node.line);
      if (index.value < 0 || index.value >= base.type.count) {
        throw new RuntimeError(`下标越界：访问索引 ${index.value}，数组长度为 ${base.type.count}`, node.line);
      }
      return { address: base.address + index.value * sizeOf(base.type.of), elementType: base.type.of };
    }
    if (isArray(base.type)) {
      if (index.value < 0 || index.value >= base.type.count) {
        throw new RuntimeError(`下标越界：访问索引 ${index.value}，数组长度为 ${base.type.count}`, node.line);
      }
      return { address: base.value + index.value * sizeOf(base.type.of), elementType: base.type.of };
    }
    if (isPointer(base.type)) {
      const elementSize = Math.max(1, sizeOf(base.type.to));
      return { address: base.value + index.value * elementSize, elementType: base.type.to };
    }
    throw new RuntimeError('只能对数组或指针使用下标', node.line);
  }

  private *memberHolder(node: Extract<Expression, { kind: 'Member' }>, depth: number): Generator<StepEvent, { address: number; type: Type }, void> {
    if (node.arrow) {
      const pointer = this.scalarOf(yield* this.eval(node.base, depth), node.line);
      const recordType = isPointer(pointer.type) ? pointer.type.to : pointer.type;
      if (!isRecord(recordType)) throw new RuntimeError('-> 只能用于结构体指针', node.line);
      if (pointer.value === 0) throw new RuntimeError('通过空指针访问字段', node.line);
      return { address: pointer.value, type: recordType };
    }
    const record = yield* this.eval(node.base, depth);
    if (!isAggregateValue(record)) throw new RuntimeError('. 只能用于结构体或结构体变量', node.line);
    return { address: record.address, type: record.type };
  }

  private readField(address: number, recordType: Type, fieldName: string, line: number): Value {
    if (!isRecord(recordType)) throw new RuntimeError('字段访问需要结构体', line);
    const field = findField(recordType, fieldName);
    if (!field) throw new RuntimeError(`结构体没有字段 '${fieldName}'`, line);
    const fieldAddress = address + field.offset;
    if (isAggregate(field.type)) return { kind: 'aggregate', type: field.type, address: fieldAddress };
    return this.memory.readValue(fieldAddress, field.type);
  }

  private *store(target: Expression, rawValue: Value, depth: number): Generator<StepEvent, Value, void> {
    let value = rawValue;
    if (target.kind === 'Var') {
      const type = this.lookup(target.name).type;
      value = this.decay(value, type, target.line);
    }
    switch (target.kind) {
      case 'Var': {
        const binding = this.lookup(target.name);
        this.writeAt(binding.address, binding.type, value, target.line);
        if (isAggregate(binding.type)) return { kind: 'aggregate', type: binding.type, address: binding.address };
        return this.memory.readValue(binding.address, binding.type);
      }
      case 'Index': {
        const { address, elementType } = yield* this.elementAddress(target, depth);
        this.writeAt(address, elementType, value, target.line);
        if (isAggregate(elementType)) return { kind: 'aggregate', type: elementType, address };
        return this.memory.readValue(address, elementType);
      }
      case 'Member': {
        const holder = yield* this.memberHolder(target, depth);
        const field = findField(holder.type, target.field);
        if (!field) throw new RuntimeError(`结构体没有字段 '${target.field}'`, target.line);
        const fieldAddress = holder.address + field.offset;
        this.writeAt(fieldAddress, field.type, value, target.line);
        if (isAggregate(field.type)) return { kind: 'aggregate', type: field.type, address: fieldAddress };
        return this.memory.readValue(fieldAddress, field.type);
      }
      case 'Unary': {
        if (target.op !== '*') throw new RuntimeError('这个表达式不能作为赋值目标', target.line);
        const pointer = this.scalarOf(yield* this.eval(target.operand, depth), target.line);
        const pointee = isPointer(pointer.type) ? pointer.type.to : INT;
        if (pointer.value === 0) throw new RuntimeError('通过空指针写入', target.line);
        this.writeAt(pointer.value, pointee, value, target.line);
        return value;
      }
      case 'Cast':
        return yield* this.store(target.operand, value, depth);
      case 'Comma':
        yield* this.eval(target.left, depth);
        return yield* this.store(target.right, value, depth);
      default:
        throw new RuntimeError('这个表达式不能作为赋值目标', target.line);
    }
  }

  private *addressOf(node: Expression, depth: number): Generator<StepEvent, Value, void> {
    switch (node.kind) {
      case 'Var': {
        const entry = this.findFunction(node.name);
        if (entry && !this.hasBinding(node.name)) return { type: pointerTo(entry.type), value: entry.address };
        const binding = this.lookup(node.name);
        return { type: pointerTo(binding.type), value: binding.address };
      }
      case 'Member': {
        const holder = yield* this.memberHolder(node, depth);
        return { type: pointerTo(holder.type), value: holder.address };
      }
      case 'Index': {
        const { address, elementType } = yield* this.elementAddress(node, depth);
        return { type: pointerTo(elementType), value: address };
      }
      case 'Unary': {
        if (node.op === '*') {
          const pointer = this.scalarOf(yield* this.eval(node.operand, depth), node.line);
          return { type: pointerTo(isPointer(pointer.type) ? pointer.type.to : INT), value: pointer.value };
        }
        break;
      }
      default: break;
    }
    const value = yield* this.eval(node, depth);
    if (isAggregateValue(value)) return { type: pointerTo(value.type), value: value.address };
    if (isPointer(value.type)) return value;
    throw new RuntimeError('不能对这个表达式取地址', node.line);
  }

  private writeAt(address: number, type: Type, value: Value, line: number): void {
    if (isAggregate(type)) {
      if (!isAggregateValue(value)) throw new RuntimeError(`${typeName(type)} 需要一个整体值`, line);
      copyAggregate(this.memory, address, value.address, type);
      return;
    }
    if (isAggregateValue(value)) throw new RuntimeError(`不能把 ${typeName(value.type)} 赋值给 ${typeName(type)}`, line);
    if (!isScalar(type)) throw new RuntimeError(`不能给 ${typeName(type)} 赋值`, line);
    this.memory.writeValue(address, type, value);
  }

  /**
   * C array-to-pointer conversion: an array used where a pointer is expected
   * becomes a pointer to its first element.
   */
  private decay(value: Value, target: Type, line: number): Value {
    if (!isPointer(target)) return value;
    if (isAggregateValue(value)) {
      if (!isArray(value.type)) throw new RuntimeError(`${typeName(value.type)} 不能转换为指针`, line);
      return { type: pointerTo(value.type.of), value: value.address };
    }
    return value;
  }

  private scalarOf(value: Value, line: number): ScalarValue {
    if (isAggregateValue(value)) {
      throw new RuntimeError(`这里需要单个数值，实际得到的是${typeName(value.type)}`, line);
    }
    return value;
  }

  /* ---------- Calls ---------- */

  private *call(node: Extract<Expression, { kind: 'Call' }>, depth: number): Generator<StepEvent, Value, void> {
    let entry: FunctionEntry | undefined;
    let functionType: Extract<Type, { kind: 'function' }> | undefined;

    if (node.callee.kind === 'Var') {
      const known = this.findFunction(node.callee.name);
      if (known) {
        entry = known;
        functionType = known.type;
      } else if (isNative(node.callee.name)) {
        return yield* this.callNative(node, depth);
      }
    }
    if (!entry || !functionType) {
      const callee = this.scalarOf(yield* this.eval(node.callee, depth), node.line);
      const target = isPointer(callee.type) ? callee.type.to : callee.type;
      if (target.kind !== 'function') throw new RuntimeError('调用的对象不是函数', node.line);
      functionType = target;
      entry = this.functionByAddress.get(callee.value);
      if (!entry) throw new RuntimeError('函数指针没有指向本文件内已定义的函数', node.line);
    }
    if (!entry.body) throw new RuntimeError(`函数 ${entry.name} 只有声明，没有可链接的函数定义`, node.line);
    if (depth >= MAX_DEPTH) throw new RuntimeError(`调用层数超过 ${MAX_DEPTH}，可能存在无限递归`, node.line);
    const signature: Extract<Type, { kind: 'function' }> = functionType;

    const args: Value[] = [];
    for (const argument of node.args) args.push(yield* this.eval(argument, depth));
    const converted = args.map((argument, index) => {
      const paramType = signature.params[index]?.type;
      return paramType ? this.decay(argument, paramType, node.line) : argument;
    });
    return yield* this.invokeUser(entry, converted, depth, signature);
  }

  private *invokeUser(entry: FunctionEntry, args: Value[], depth: number, signature?: Extract<Type, { kind: 'function' }>): Generator<StepEvent, Value, void> {
    // Parameter names always come from the real declaration; a function-pointer
    // type only carries types, so bindings would otherwise lose their names.
    const functionType = entry.type;
    const returnType = (signature ?? entry.type).ret;
    const body = entry.body as Extract<Statement, { kind: 'Block' }>;
    const frame: CallFrame = { label: entry.name, functionName: entry.name, line: body.line, depth: depth + 1 };
    yield { type: 'call', frame };

    const marker = this.bindings.length;
    const callerUnit = this.currentUnit;
    const callerStart = this.localStart;
    this.currentUnit = entry.unit;
    this.localStart = marker;
    const frameBase = this.memory.allocStack(FRAME_SLOTS, `${entry.name} 调用帧`);
    this.frames.push(frame);
    try {
      functionType.params.forEach((param: Param, index: number) => {
        const address = this.memory.allocStack(Math.max(1, sizeOf(param.type)), param.name || `参数${index + 1}`);
        this.bindings.push({ name: param.name, type: param.type, address, frame: entry.name, kind: 'parameter' });
        const argument = args[index];
        if (argument === undefined) return;
        if (isAggregate(param.type)) {
          if (!isAggregateValue(argument)) throw new RuntimeError(`参数 ${index + 1} 需要一个 ${typeName(param.type)} 类型的值`, entry.name.length ? 0 : 0);
          copyAggregate(this.memory, address, argument.address, param.type);
          return;
        }
        if (isAggregateValue(argument)) throw new RuntimeError(`不能把 ${typeName(argument.type)} 传给 ${typeName(param.type)} 参数`, 0);
        this.memory.writeValue(address, param.type, argument);
      });

      const flow = yield* this.execBlock(body, depth + 1);
      yield { type: 'return', frame };
      if (returnType.kind === 'void') return { type: VOID, value: 0 };
      if (flow?.signal !== 'return' || flow.value === undefined) return { type: returnType, value: 0 };
      return flow.value;
    } finally {
      this.currentUnit = callerUnit;
      this.localStart = callerStart;
      this.frames.pop();
      this.bindings.length = marker;
      this.memory.releaseStack(frameBase);
    }
  }

  /* ---------- Native library calls ---------- */

  private *callNative(node: Extract<Expression, { kind: 'Call' }>, depth: number): Generator<StepEvent, Value, void> {
    const name = (node.callee as Extract<Expression, { kind: 'Var' }>).name;
    const args: Value[] = [];
    for (const argument of node.args) args.push(yield* this.eval(argument, depth));
    const scalars = args.map(argument => {
      if (isAggregateValue(argument)) {
        // Arrays and strings are passed to the library as a pointer to their first element.
        if (isArray(argument.type)) return { type: pointerTo(argument.type.of), value: argument.address };
        throw new RuntimeError(`${name}() 的参数不能是结构体`, node.line);
      }
      return { type: argument.type, value: argument.value };
    });
    if (name === 'qsort') {
      const [base, count, width, comparator] = scalars;
      const compare = comparator && this.functionByAddress.get(comparator.value);
      if (!base || !count || !width || !compare?.body || count.value < 0 || !Number.isInteger(count.value) || width.value <= 0 || !Number.isInteger(width.value)) throw new RuntimeError('qsort 参数无效或比较函数未定义', node.line);
      if (depth >= MAX_DEPTH) throw new RuntimeError('qsort 比较函数调用层数超过上限', node.line);
      this.memory.readBytes(base.value, count.value * width.value);
      // The standard specifies sorted output, not the internal sort algorithm.
      for (let i = 1; i < count.value; i++) {
        for (let j = i; j > 0; j--) {
          const left = base.value + (j - 1) * width.value, right = left + width.value;
          const result = this.scalarOf(yield* this.invokeUser(compare, [
            { type: pointerTo(VOID), value: left }, { type: pointerTo(VOID), value: right },
          ], depth), node.line);
          if (result.value <= 0) break;
          const temporary = this.memory.readBytes(left, width.value);
          this.memory.writeBytes(left, this.memory.readBytes(right, width.value));
          this.memory.writeBytes(right, temporary);
          yield { type: 'statement', line: node.line };
        }
      }
      return { type: VOID, value: 0 };
    }
    const before = this.memory.liveObjects().map(item => item.address);
    const result = callNative(this, name, scalars);
    if (result.freed) yield { type: 'free', address: result.freed, label: 'free() 释放的堆对象' };
    const created = this.memory.liveObjects().find(item => !before.includes(item.address));
    if (created) {
      yield { type: 'allocate', address: created.address, size: created.size, label: created.label };
      this.bindings.push({
        name: `${name}() 分配的内存`,
        type: pointerTo({ kind: 'void' }),
        address: created.address,
        frame: this.currentFrame(),
        kind: 'heap',
        allocationEnd: created.address + created.size,
      });
    }
    return { type: nativeReturnType(name), value: result.value };
  }

  functionNameAt(address: number): string | undefined {
    return this.functionByAddress.get(address)?.name;
  }

  /* ---------- Operators ---------- */

  private binary(op: BinaryOp, left: Value, right: Value, line: number): Value {
    const a = this.scalarOf(left, line);
    const b = this.scalarOf(right, line);
    if (isPointer(a.type) || isPointer(b.type)) return this.pointerArithmetic(op, a, b, line);
    if (!isArithmetic(a.type) || !isArithmetic(b.type)) {
      throw new RuntimeError(`运算符 ${op} 不适用于 ${typeName(a.type)} 和 ${typeName(b.type)}`, line);
    }
    const resultType = usualArithmetic(a.type, b.type);
    const asInt = (value: number): Value => ({ type: resultType, value: wrapInteger(value, resultType) });
    switch (op) {
      case '+': return asInt(a.value + b.value);
      case '-': return asInt(a.value - b.value);
      case '*': return asInt(a.value * b.value);
      case '/':
        if (b.value === 0) throw new RuntimeError('整数除法或取模时除数为 0', line);
        return resultType.kind === 'float' ? { type: resultType, value: a.value / b.value } : asInt(Math.trunc(a.value / b.value));
      case '%':
        if (b.value === 0) throw new RuntimeError('整数除法或取模时除数为 0', line);
        return asInt(a.value % b.value);
      case '<<': return asInt(a.value * 2 ** b.value);
      case '>>': return asInt(Math.floor(a.value / 2 ** b.value));
      case '<': return { type: INT, value: a.value < b.value ? 1 : 0 };
      case '>': return { type: INT, value: a.value > b.value ? 1 : 0 };
      case '<=': return { type: INT, value: a.value <= b.value ? 1 : 0 };
      case '>=': return { type: INT, value: a.value >= b.value ? 1 : 0 };
      case '==': return { type: INT, value: a.value === b.value ? 1 : 0 };
      case '!=': return { type: INT, value: a.value !== b.value ? 1 : 0 };
      case '&': return asInt((a.value | 0) & (b.value | 0));
      case '^': return asInt((a.value | 0) ^ (b.value | 0));
      case '|': return asInt((a.value | 0) | (b.value | 0));
      default: throw new RuntimeError(`未处理的运算符 ${op}`, line);
    }
  }

  private pointerArithmetic(op: BinaryOp, left: ScalarValue, right: ScalarValue, line: number): Value {
    const leftPointer = isPointer(left.type);
    const rightPointer = isPointer(right.type);
    if (op === '+' || op === '-') {
      if (leftPointer && rightPointer) throw new RuntimeError('本版暂不支持指针相减', line);
      const pointer = leftPointer ? left : right;
      const integer = leftPointer ? right : left;
      if (!isInteger(integer.type)) throw new RuntimeError(`不能把 ${typeName(integer.type)} 加到指针上`, line);
      const elementSize = pointer.type.kind === 'pointer' ? Math.max(1, sizeOf(pointer.type.to)) : 1;
      const delta = op === '+' ? integer.value : -integer.value;
      return { type: pointer.type, value: pointer.value + delta * elementSize };
    }
    if (op === '==' || op === '!=') {
      const same = left.value === right.value;
      return { type: INT, value: op === '==' ? (same ? 1 : 0) : (same ? 0 : 1) };
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      const result = op === '<' ? left.value < right.value
        : op === '>' ? left.value > right.value
          : op === '<=' ? left.value <= right.value : left.value >= right.value;
      return { type: INT, value: result ? 1 : 0 };
    }
    throw new RuntimeError(`运算符 ${op} 不适用于指针`, line);
  }

  private cast(value: Value, to: Type, line: number): Value {
    if (isAggregateValue(value)) {
      if (isAggregate(to)) return value;
      if (isPointer(to) && isArray(value.type)) return { type: to, value: value.address };
      throw new RuntimeError(`不能把 ${typeName(value.type)} 转换为 ${typeName(to)}`, line);
    }
    if (isPointer(to)) return { type: to, value: wrapInteger(value.value, INT) };
    if (isFloating(to)) return { type: to, value: value.value };
    if (isInteger(to)) {
      if (isFloating(value.type)) {
        const truncated = Math.trunc(value.value);
        const [min, max] = integerRange(to);
        if (truncated < min || truncated > max) {
          throw new RuntimeError(`浮点数 ${value.value} 超出 ${typeName(to)} 的取值范围`, line);
        }
        return { type: to, value: truncated };
      }
      return { type: to, value: wrapInteger(value.value, to) };
    }
    return { type: to, value: value.value };
  }

  /* ---------- Lookup and I/O ---------- */

  private hasBinding(name: string): boolean {
    return !!this.findBinding(name);
  }

  private findFunction(name: string): FunctionEntry | undefined {
    if (this.currentUnit && !this.visible.get(this.currentUnit)?.has(name)) return undefined;
    return this.functions.get(`${this.currentUnit}:${name}`) ?? this.functions.get(name);
  }

  private findBinding(name: string): Binding | undefined {
    let external: Binding | undefined;
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const binding = this.bindings[i];
      if (binding.name !== name) continue;
      if (binding.kind !== 'global') { if (i >= this.localStart) return binding; continue; }
      if (this.currentUnit && !this.visible.get(this.currentUnit)?.has(name)) continue;
      if (binding.internal && binding.unit !== this.currentUnit) continue;
      if (binding.internal) return binding;
      external ??= binding;
    }
    return external;
  }

  private lookup(name: string): Binding {
    const binding = this.findBinding(name);
    if (binding) return binding;
    throw new RuntimeError(`未声明的标识符 '${name}'`, this.lastLine);
  }

  write(text: string): void {
    this.output += text;
    this.onOutput?.(text);
    if (this.output.length > 200_000) throw new RuntimeError('输出过长，程序已停止');
  }

  readIntegerPlaceholder(): void {}

  scanInput(): string { return this.input.slice(this.inputCursor); }

  advanceInput(length: number): void {
    this.inputCursor = Math.min(this.input.length, this.inputCursor + length);
  }

  /** Raw bytes as a string, for parsing format strings and comparing text. */
  readRawString(address: number): string {
    const bytes: number[] = [];
    for (let offset = 0; offset < 8192; offset++) {
      const byte = this.memory.readBytes(address + offset, 1)[0];
      if (byte === 0) break;
      bytes.push(byte);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
  }

  /** Printable form for display; control bytes become visible escapes. */
  readCString(address: number): string {
    const bytes: number[] = [];
    for (let offset = 0; offset < 4096; offset++) {
      const byte = this.memory.readBytes(address + offset, 1)[0];
      if (byte === 0) break;
      bytes.push(byte);
    }
    return bytes.map(byte => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '\\x' + byte.toString(16).padStart(2, '0'))).join('');
  }

  heapAllocate(size: number, label: string): number {
    const address = this.memory.allocHeap(Math.max(1, size), label);
    if (address === undefined) throw new RuntimeError('堆空间不足，分配失败');
    this.memory.zero(address, Math.max(1, size));
    return address;
  }

  heapFree(address: number): boolean {
    if (address === 0) return false;
    const freed = this.memory.free(address);
    if (freed) {
      this.bindings.length = this.bindings.filter(binding => !(binding.kind === 'heap' && binding.address === address)).length;
    }
    return freed;
  }

  isFreed(address: number): boolean {
    return this.memory.wasFreed(address);
  }
}

/** Return type of the supported standard library functions. */
export function nativeReturnType(name: string): Type {
  if (name === 'malloc' || name === 'calloc') return pointerTo(VOID);
  if (['strcpy', 'strncpy', 'strcat', 'strncat', 'strchr', 'strstr', 'fgets'].includes(name)) return pointerTo(CHAR);
  if (['memcpy', 'memmove', 'memset'].includes(name)) return pointerTo(VOID);
  if (['atof', 'sqrt', 'pow', 'fabs', 'floor', 'ceil', 'round', 'sin', 'cos', 'tan', 'log', 'exp', 'fmod'].includes(name)) return DOUBLE;
  if (name === 'free' || name === 'exit' || name === 'qsort' || name === 'srand') return VOID;
  if (name === 'strlen') return { kind: 'int', bits: 64, signed: false };
  return INT;
}
