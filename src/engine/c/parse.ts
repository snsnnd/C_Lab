// Compile a tree-sitter C parse tree into a compact AST for the evaluator.
// The supported subset is documented in README; anything outside it raises a
// CSourceError with a line number instead of silently mis-evaluating.

import type { Node } from 'web-tree-sitter';
import {
  CHAR, DOUBLE, FLOAT, INT, LONG, UNSIGNED_INT, UNSIGNED_LONG, VOID,
  alignOf, intType, layoutRecord, pointerTo, sizeOf, typeName,
  type FieldSpec, type Param, type RecordType, type Type,
} from './types';

export class CSourceError extends Error {
  constructor(message: string, readonly line: number) {
    super(message);
    this.name = 'CSourceError';
  }
}

/* ---------- Declarations ---------- */

export type StorageClass = 'auto' | 'static' | 'extern' | 'typedef' | 'register';

export type BlockStatement = Extract<Statement, { kind: 'Block' }>;

export interface VarDecl {
  kind: 'VarDecl';
  name: string;
  type: Type;
  storage: StorageClass;
  init?: Initializer;
  readonly?: boolean;
  line: number;
}

export interface ParamDecl { name: string; type: Type }

export interface FuncDecl {
  kind: 'FuncDecl';
  name: string;
  type: Extract<Type, { kind: 'function' }>;
  storage: StorageClass;
  body?: Extract<Statement, { kind: 'Block' }>;
  line: number;
}

export interface TypeDecl {
  kind: 'TypeDecl';
  name: string;
  storage: 'typedef';
  type: Type;
  line: number;
}

export type Declaration = VarDecl | FuncDecl | TypeDecl;

/* ---------- Initializers ---------- */

export type Initializer =
  | { kind: 'Expr'; expr: Expression }
  | { kind: 'List'; items: Initializer[] }
  | { kind: 'Designated'; field: string; index?: number; value: Initializer };

/* ---------- Statements ---------- */

export type Statement =
  | { kind: 'Block'; body: Statement[]; line: number }
  | { kind: 'ExprStmt'; expr: Expression; line: number }
  | { kind: 'DeclStmt'; decls: Declaration[]; line: number }
  | { kind: 'If'; cond: Expression; then: Statement; otherwise?: Statement; line: number }
  | { kind: 'While'; cond: Expression; body: Statement; line: number }
  | { kind: 'DoWhile'; body: Statement; cond: Expression; line: number }
  | { kind: 'For'; init?: Statement; cond?: Expression; update?: Expression; body: Statement; line: number }
  | { kind: 'Switch'; subject: Expression; body: BlockStatement; line: number }
  | { kind: 'Case'; value: Expression | undefined; body: Statement[]; line: number }
  | { kind: 'Default'; body: Statement[]; line: number }
  | { kind: 'Break'; line: number }
  | { kind: 'Continue'; line: number }
  | { kind: 'Return'; value?: Expression; line: number }
  | { kind: 'Label'; name: string; body: Statement; line: number }
  | { kind: 'Goto'; name: string; line: number }
  | { kind: 'Empty'; line: number };

/* ---------- Expressions ---------- */

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '<<' | '>>' | '<' | '>' | '<=' | '>=' | '==' | '!='
  | '&' | '^' | '|' | '&&' | '||';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '<<=' | '>>=' | '&=' | '^=' | '|=';
export type UnaryOp = '-' | '+' | '!' | '~' | '*' | '&';

export type Expression =
  | { kind: 'Num'; value: number; type: Type; line: number; raw: string }
  | { kind: 'Str'; bytes: number[]; type: Type; line: number }
  | { kind: 'Char'; value: number; line: number; raw: string }
  | { kind: 'Var'; name: string; line: number }
  | { kind: 'Binary'; op: BinaryOp; left: Expression; right: Expression; type: Type; line: number }
  | { kind: 'Logical'; op: '&&' | '||'; left: Expression; right: Expression; line: number }
  | { kind: 'Unary'; op: UnaryOp; operand: Expression; line: number }
  | { kind: 'Assign'; op: AssignOp; target: Expression; value: Expression; line: number }
  | { kind: 'Ternary'; cond: Expression; then: Expression; otherwise: Expression; line: number }
  | { kind: 'Call'; callee: Expression; args: Expression[]; line: number }
  | { kind: 'Index'; base: Expression; index: Expression; line: number }
  | { kind: 'Member'; base: Expression; field: string; arrow: boolean; line: number }
  | { kind: 'Cast'; to: Type; operand: Expression; line: number }
  | { kind: 'SizeofType'; type: Type; line: number }
  | { kind: 'SizeofExpr'; operand: Expression; line: number }
  | { kind: 'Comma'; left: Expression; right: Expression; line: number }
  | { kind: 'IncDec'; op: '++' | '--'; operand: Expression; prefix: boolean; line: number };

/* ---------- Program ---------- */

export interface Program {
  decls: Declaration[];
  /** Translation-unit ownership for the linker and runtime name lookup. */
  units?: Map<Declaration, string>;
  /** Declarations in source order, used to report struct layout and enum values. */
  tags: { kind: 'struct' | 'union' | 'enum'; name: string; type: Type; line: number }[];
}

/* ---------- Context ---------- */

interface Scope { typedefs: Map<string, Type>; tags: Map<string, Type> }

/** Index of the named child carrying `field`, or -1. */
function valueFieldIndex(node: Node, field: string): number {
  for (let i = 0; i < node.namedChildCount; i++) {
    if (node.fieldNameForNamedChild(i) === field) return i;
  }
  return -1;
}

/** Unique marker for "the return type", filled in after the declarator is read. */
const RETURN_PLACEHOLDER: Type = { kind: 'void' };
const RETURN_MARKER = RETURN_PLACEHOLDER;

/** Replace the placeholder wherever it appears inside a derived type. */
function substituteReturn(type: Type, signature: Type): Type {
  if (type === RETURN_MARKER) return signature;
  if (type.kind === 'pointer') return { kind: 'pointer', to: substituteReturn(type.to, signature) };
  if (type.kind === 'array') return { kind: 'array', of: substituteReturn(type.of, signature), count: type.count };
  if (type.kind === 'function') return { ...type, ret: substituteReturn(type.ret, signature) };
  return type;
}

const TYPE_NODES = new Set(['type_descriptor', 'primitive_type', 'sized_type_specifier', 'struct_specifier', 'union_specifier', 'enum_specifier', 'type_identifier']);
const isTypeNode = (node: Node): boolean => TYPE_NODES.has(node.type);

/** A type as written in a cast or sizeof, including any declarator suffix. */
function parseTypeNode(parser: Parser, node: Node): Type {
  if (node.type !== 'type_descriptor') return parser.declaratorBase(node);
  const declarator = node.namedChildren.find(child => child.type.endsWith('_declarator'));
  if (!declarator) return parser.declaratorBase(node);
  return parser.applyDeclarator(parser.declaratorBase(node), declarator).type;
}

export class Parser {
  private typedefs = new Map<string, Type>();
  /** Completed and in-progress tags, keyed by `struct Name` / `enum Name`. */
  private tags = new Map<string, Type>();
  private recordsBeingBuilt = new Map<string, RecordType>();

  constructor(private readonly source: string) {}

  private fail(node: Node | null, message: string): never {
    const line = node?.startPosition?.row != null ? node.startPosition.row + 1 : this.lineOfOffset(node?.startIndex ?? 0);
    throw new CSourceError(message, line);
  }

  private lineOfOffset(offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < this.source.length; i++) if (this.source[i] === '\n') line++;
    return line;
  }

  parse(root: Node): Program {
    const decls: Declaration[] = [];
    const tags: Program['tags'] = [];
    for (const child of root.namedChildren) {
      if (child.type === 'preproc_include' || child.type === 'preproc_def' || child.type === 'preproc_ifdef') continue;
      const parsed = this.parseTopLevel(child);
      for (const item of parsed) {
        if (item.kind === 'FuncDecl') decls.push(item);
        else if (item.kind === 'VarDecl') decls.push(item);
        else if (item.kind === 'TypeDecl') decls.push(item);
      }
      if (child.type === 'struct_specifier' || child.type === 'union_specifier' || child.type === 'enum_specifier') {
        const tagName = child.childForFieldName('name')?.text ?? '';
        const tagKind = child.type === 'struct_specifier' ? 'struct' : child.type === 'union_specifier' ? 'union' : 'enum';
        const type = this.tags.get(`${tagKind} ${tagName}`);
        if (type) tags.push({ kind: tagKind, name: tagName, type, line: this.lineOfOffset(child.startIndex) });
      }
    }
    return { decls, tags };
  }

  private parseTopLevel(node: Node): Declaration[] {
    const kind = node.type;
    if (kind === 'function_definition') return [this.parseFunction(node)];
    if (kind === 'declaration') return this.parseDeclaration(node);
    if (kind === 'type_definition') return [this.parseTypedef(node)];
    if (kind === 'struct_specifier' || kind === 'enum_specifier' || kind === 'union_specifier') {
      if (kind === 'enum_specifier') this.parseEnum(node);
      else this.parseStruct(node, kind === 'union_specifier' ? 'union' : 'struct');
      return [];
    }
    if (kind === 'linkage_specification') {
      return node.namedChildren.flatMap(child => this.parseTopLevel(child));
    }
    this.fail(node, `暂不支持顶层语句：${kind}`);
  }

  /* ---------- Specifiers ---------- */

  private parseDeclarationSpecifier(node: Node): { base: Type; storage: StorageClass; readonly: boolean } {
    if (node.type === 'type_identifier') {
      const base = node.text === '_Bool' ? this.primitive('_Bool') : this.typedefs.get(node.text);
      if (!base) this.fail(node, `未知的类型名 '${node.text}'`);
      return { base, storage: 'auto', readonly: false };
    }
    // A bare primitive type node is the whole type, not a container of children.
    if (node.type === 'primitive_type') {
      return { base: this.primitive(node.text), storage: 'auto', readonly: false };
    }
    if (node.type === 'sized_type_specifier') {
      return { base: this.sizedType(node), storage: 'auto', readonly: false };
    }
    // A bare tag specifier is already the whole type; its name child is not a typedef.
    if (node.type === 'struct_specifier' || node.type === 'union_specifier' || node.type === 'enum_specifier') {
      const base = node.type === 'enum_specifier'
        ? this.parseEnum(node)
        : this.parseStruct(node, node.type === 'union_specifier' ? 'union' : 'struct');
      return { base, storage: 'auto', readonly: false };
    }
    let base: Type | undefined;
    let storage: StorageClass = 'auto';
    let readonly = false;
    let signedness: boolean | undefined;
    let longCount = 0;
    let shortCount = 0;
    let seenType = false;

    const apply = () => {
      if (!seenType) return;
      if (base?.kind === 'int' && base.bits === 8) base = intType(8, signedness ?? true);
      else if (base?.kind === 'float' && base.bits === 32) base = longCount ? DOUBLE : FLOAT;
      else if (base?.kind === 'float' && base.bits === 64) base = DOUBLE;
      else if (longCount) base = intType(64, signedness ?? true, longCount >= 2 ? 5 : 4);
      else if (shortCount) base = intType(16, signedness ?? true);
      else base = intType(32, signedness ?? true);
      seenType = false;
      signedness = undefined;
      longCount = 0;
      shortCount = 0;
    };

    for (const child of node.namedChildren) {
      switch (child.type) {
        case 'storage_class_specifier': storage = child.text as StorageClass; continue;
         case 'type_qualifier': if (child.text === 'const') readonly = true; continue;
        case 'signed': seenType = true; signedness = true; continue;
        case 'unsigned': seenType = true; signedness = false; continue;
        case 'long': seenType = true; longCount++; continue;
        case 'short': seenType = true; shortCount++; continue;
        case 'primitive_type':
          apply();
          base = this.primitive(child.text);
          continue;
        case 'sized_type_specifier':
          apply();
          base = this.sizedType(child);
          continue;
        case 'struct_specifier': apply(); base = this.parseStruct(child, 'struct'); continue;
        case 'union_specifier': apply(); base = this.parseStruct(child, 'union'); continue;
        case 'enum_specifier': apply(); base = this.parseEnum(child); continue;
        case 'type_identifier': {
          apply();
          const known = child.text === '_Bool' ? this.primitive('_Bool') : this.typedefs.get(child.text);
          if (!known) this.fail(child, `未知的类型名 '${child.text}'，请确认已有 typedef 或拼写正确`);
          base = known;
          continue;
        }
        default: continue;
      }
    }
    apply();
    if (!base) base = INT;
     return { base, storage, readonly };
  }

  private primitive(text: string): Type {
    switch (text) {
      case 'void': return VOID;
      case 'char': return CHAR;
      case 'int': return INT;
      case '_Bool': case 'bool': return { kind: 'int', bits: 8, signed: false, boolean: true };
      case 'float': return FLOAT;
      case 'double': return DOUBLE;
      default: return INT;
    }
  }

  private sizedType(node: Node): Type {
    const names = node.text.split(/\s+/);
    const has = (name: string) => names.includes(name);
    if (has('char')) return intType(8, !has('unsigned'));
    if (has('short')) return intType(16, !has('unsigned'));
    if (has('long')) return intType(64, !has('unsigned'), has('long long') || node.text.includes('long long') ? 5 : 4);
    return intType(32, !has('unsigned'));
  }

  private parseStruct(node: Node, tag: 'struct' | 'union'): Type {
    const name = node.childForFieldName('name')?.text ?? '';
    const body = node.childForFieldName('body');
    const key = `${tag} ${name}`;
    if (!body) {
      // Self reference: struct Node * next inside struct Node's own body must
      // resolve to the record being built, not to a second empty forward type.
      const building = this.recordsBeingBuilt.get(key);
      if (building) return building;
      const existing = this.tags.get(key);
      if (existing) return existing;
      const forward: Type = { kind: 'record', name, tag, fields: [], complete: false };
      this.tags.set(key, forward);
      return forward;
    }
    const existing = this.recordsBeingBuilt.get(key);
    if (existing) return existing;
    const record: RecordType = { kind: 'record', name, tag, fields: [], complete: true };
    this.recordsBeingBuilt.set(key, record);
    const fields: FieldSpec[] = [];
    for (const member of body.namedChildren) {
      if (member.type !== 'field_declaration') continue;
      const spec = this.parseDeclarationSpecifier(member.namedChildren[0]);
      const declarator = member.childForFieldName('declarator')
        ?? member.namedChildren.slice(1).find(child => child.type.endsWith('declarator') || child.type === 'field_identifier');
      const named = declarator ? this.parseDeclarator(spec.base, declarator) : { type: spec.base, name: '' };
      const fieldName = named.name;
      if (!fieldName) {
        // Anonymous struct/union member: expose its fields at this level.
        const inner = named.type.kind === 'record' ? named.type.fields.map(f => ({ ...f })) : [];
        fields.push(...inner);
        continue;
      }
      fields.push({ name: fieldName, type: named.type });
    }
    record.fields = fields;
    this.recordsBeingBuilt.delete(key);
    this.tags.set(key, record);
    return record;
  }

  private parseEnum(node: Node): Type {
    const name = node.childForFieldName('name')?.text ?? '';
    const body = node.childForFieldName('body');
    const key = `enum ${name}`;
    if (!body) return this.tags.get(key) ?? { kind: 'enum', name, complete: false, base: INT };
    const enumType: Type = { kind: 'enum', name, complete: true, base: INT };
    this.tags.set(key, enumType);
    let next = 0;
    for (const item of body.namedChildren) {
      if (item.type !== 'enumerator') continue;
      const itemName = item.childForFieldName('name')?.text ?? item.namedChildren[0]?.text;
      if (!itemName) continue;
      const valueNode = item.childForFieldName('value');
      const value = valueNode ? this.constantInt(valueNode) : next;
      next = value + 1;
      (enumType as { enumerators?: Record<string, number> }).enumerators = {
        ...((enumType as { enumerators?: Record<string, number> }).enumerators ?? {}),
        [itemName]: value,
      };
      this.tags.set(`enum ${itemName}`, { kind: 'int', bits: 32, signed: true });
      this.enumNames.set(itemName, { enumName: name, value });
    }
    return enumType;
  }

  enumNames = new Map<string, { enumName: string; value: number }>();

  private constantInt(node: Node): number {
    const evaluate = (expr: Expression): number => {
      if (expr.kind === 'Num' || expr.kind === 'Char') return expr.value;
      if (expr.kind === 'SizeofType') return sizeOf(expr.type);
      if (expr.kind === 'Cast') return Math.trunc(evaluate(expr.operand));
      if (expr.kind === 'Ternary') return evaluate(expr.cond) ? evaluate(expr.then) : evaluate(expr.otherwise);
      if (expr.kind === 'Unary') {
        const value = evaluate(expr.operand);
        if (expr.op === '+') return value;
        if (expr.op === '-') return -value;
        if (expr.op === '!') return Number(!value);
        if (expr.op === '~') return ~value;
      }
      if (expr.kind === 'Binary' || expr.kind === 'Logical') {
        const left = evaluate(expr.left);
        if (expr.op === '&&') return Number(!!left && !!evaluate(expr.right));
        if (expr.op === '||') return Number(!!left || !!evaluate(expr.right));
        const right = evaluate(expr.right);
        if ((expr.op === '/' || expr.op === '%') && !right) this.fail(node, '整数常量表达式不能除以零');
        switch (expr.op) {
          case '+': return left + right; case '-': return left - right; case '*': return left * right;
          case '/': return Math.trunc(left / right); case '%': return left % right;
          case '<<': return left << right; case '>>': return left >> right;
          case '&': return left & right; case '|': return left | right; case '^': return left ^ right;
          case '==': return Number(left === right); case '!=': return Number(left !== right);
          case '<': return Number(left < right); case '<=': return Number(left <= right);
          case '>': return Number(left > right); case '>=': return Number(left >= right);
        }
      }
      this.fail(node, '此处需要整数常量表达式，暂不支持变长数组');
    };
    const value = evaluate(this.parseExpression(node));
    if (!Number.isSafeInteger(value)) this.fail(node, '整数常量表达式超出教学模型范围');
    return value;
  }

  /* ---------- Declarators ---------- */

  private parseDeclarator(base: Type, node: Node): { type: Type; name: string } {
    switch (node.type) {
      case 'identifier':
      case 'type_identifier':
      case 'field_identifier':
        return { type: base, name: node.text };
      case 'pointer_declarator':
      case 'abstract_pointer_declarator': {
        const child = node.namedChildren[0];
        return child ? this.parseDeclarator(pointerTo(base), child) : { type: pointerTo(base), name: '' };
      }
      case 'array_declarator':
      case 'abstract_array_declarator': {
        const sizeNode = node.childForFieldName('size');
        const count = sizeNode ? this.constantInt(sizeNode) : 0;
        if (sizeNode && count <= 0) this.fail(sizeNode, '数组长度必须为正整数');
        const element: Type = { kind: 'array', of: base, count };
        const child = node.childForFieldName('declarator');
        return child ? this.parseDeclarator(element, child) : { type: element, name: '' };
      }
      case 'function_declarator':
      case 'abstract_function_declarator': {
        const declarator = node.childForFieldName('declarator') ?? node.namedChildren[0];
        const parameters = node.childForFieldName('parameters');
        const params: Param[] = [];
        let variadic = false;
        for (const param of parameters?.namedChildren ?? []) {
          if (param.type === 'variadic_parameter') { variadic = true; continue; }
          const spec = this.parseDeclarationSpecifier(param);
          const declaratorNode = param.childForFieldName('declarator') ?? param.namedChildren[1];
          const parsed = declaratorNode ? this.parseDeclarator(spec.base, declaratorNode) : { type: spec.base, name: '' };
          // C adjusts array/function parameter declarations to pointers. This
          // applies to both prototypes and definitions, not to local arrays.
          const type = parsed.type.kind === 'array' ? pointerTo(parsed.type.of)
            : parsed.type.kind === 'function' ? pointerTo(parsed.type) : parsed.type;
           params.push({ name: parsed.name, type, readonly: spec.readonly });
        }
        if (params.length === 1 && params[0].type.kind === 'void' && !params[0].name) params.length = 0;
        // Declarators bind right to left, so the return type is only known once the
        // inner declarator is resolved: parse it with a placeholder and substitute.
        const signature: Type = { kind: 'function', ret: base, params, variadic };
        if (!declarator) return { type: signature, name: '' };
        const inner = this.parseDeclarator(RETURN_PLACEHOLDER, declarator);
        return { type: substituteReturn(inner.type, signature), name: inner.name };
      }
      case 'init_declarator':
      case 'parenthesized_declarator': {
        const inner = this.parseDeclarator(base, node.namedChildren[0]);
        return inner;
      }
      default:
        return { type: base, name: node.text };
    }
  }

  /** Base type of a type node, ignoring any declarator. */
  declaratorBase(node: Node): Type {
    if (node.type === 'type_descriptor') {
      const inner = node.namedChildren.find(child => !child.type.endsWith('_declarator'));
      return inner ? this.declaratorBase(inner) : INT;
    }
    if (node.type === 'parenthesized_declarator') return this.declaratorBase(node.namedChildren[0]);
    return this.parseDeclarationSpecifier(node).base;
  }

  /** Apply a declarator to a base type; exposed for cast/sizeof handling. */
  applyDeclarator(base: Type, declarator: Node): { type: Type; name: string } {
    return this.parseDeclarator(base, declarator);
  }

  private parseDeclaration(node: Node): Declaration[] {
    const { base, storage, readonly } = this.parseDeclarationSpecifier(node);
    const results: Declaration[] = [];
    const declarators = node.childrenForFieldName('declarator');
    if (declarators.length === 0) return results;
    for (const declarator of declarators) {
      const isInit = declarator.type === 'init_declarator';
      const target = isInit ? declarator.namedChildren[0] : declarator;
      const parsed = this.parseDeclarator(base, target);
      if (parsed.type.kind === 'function') {
        results.push({ kind: 'FuncDecl', name: parsed.name, type: parsed.type, storage, line: this.lineOfOffset(node.startIndex) });
        continue;
      }
      const initializer = isInit
        ? this.parseInitializer(declarator.childForFieldName('value')!)
        : undefined;
      if (readonly && !initializer) this.fail(node, `const 对象 ${parsed.name} 必须有初始化器`);
      if (parsed.type.kind === 'array' && parsed.type.count === 0 && initializer) {
        if (initializer.kind === 'List') {
          let cursor = 0, count = 0;
          for (const item of initializer.items) {
            if (item.kind === 'Designated' && item.index !== undefined) cursor = item.index;
            count = Math.max(count, ++cursor);
          }
          parsed.type = { ...parsed.type, count };
        }
        else if (initializer.kind === 'Expr' && initializer.expr.kind === 'Str') parsed.type = { ...parsed.type, count: initializer.expr.bytes.length };
      }
      results.push({
        kind: 'VarDecl', name: parsed.name, type: parsed.type, storage, init: initializer,
        readonly,
        line: this.lineOfOffset(declarator.startIndex),
      });
    }
    return results;
  }

  private parseTypedef(node: Node): TypeDecl {
    const specNode = node.namedChildren[0];
    const { base } = this.parseDeclarationSpecifier(specNode);
    for (const declarator of node.namedChildren.slice(1)) {
      const parsed = this.parseDeclarator(base, declarator);
      if (parsed.name) this.typedefs.set(parsed.name, parsed.type);
    }
    const names = node.namedChildren.slice(1).map(child => this.declaratorName(child)).filter(Boolean);
    return { kind: 'TypeDecl', name: names[0] ?? '', storage: 'typedef', type: base, line: this.lineOfOffset(node.startIndex) };
  }

  private declaratorName(node: Node): string {
    const target = node.type === 'init_declarator' ? node.namedChildren[0] : node;
    try { return this.parseDeclarator(INT, target).name; } catch { return ''; }
  }

  private parseInitializer(node: Node): Initializer {
    if (node.type === 'initializer_list') {
      return { kind: 'List', items: node.namedChildren.map(child => this.parseInitializer(child)) };
    }
    if (node.type === 'initializer_pair') {
      const designator = node.namedChildren[0];
      const value = this.parseInitializer(node.namedChildren[1]);
      const field = designator?.type === 'field_designator'
        ? designator.namedChildren[0]?.text.replace(/^\./, '')
        : undefined;
      const indexText = designator?.type === 'subscript_designator'
        ? designator.namedChildren[0]?.text.replace(/^\[|\]$/g, '')
        : undefined;
      if (field) return { kind: 'Designated', field, value };
      if (indexText !== undefined && /^\d+$/.test(indexText)) {
        return { kind: 'Designated', field: '', index: Number(indexText), value };
      }
      return value;
    }
    return { kind: 'Expr', expr: this.parseExpression(node) };
  }

  /* ---------- Statements ---------- */

  private parseStatement(node: Node): Statement {
    const line = this.lineOfOffset(node.startIndex);
    switch (node.type) {
      case 'compound_statement': {
        const body: Statement[] = [];
        for (const child of node.namedChildren) body.push(this.parseStatement(child));
        return { kind: 'Block', body, line };
      }
      case 'expression_statement':
        return { kind: 'ExprStmt', expr: this.parseExpression(node.namedChildren[0]), line };
      case 'declaration':
      case 'type_definition':
        return { kind: 'DeclStmt', decls: this.parseTopLevel(node), line };
      case 'if_statement': {
        const cond = this.parseExpression(node.childForFieldName('condition')!);
        const consequence = this.parseStatement(node.childForFieldName('consequence')!);
        const alternative = node.childForFieldName('alternative');
        return { kind: 'If', cond, then: consequence, otherwise: alternative ? this.parseStatement(alternative) : undefined, line };
      }
      case 'while_statement':
        return {
          kind: 'While',
          cond: this.parseExpression(node.childForFieldName('condition')!),
          body: this.parseStatement(node.childForFieldName('body')!),
          line,
        };
      case 'do_statement': {
        const body = this.parseStatement(node.childForFieldName('body')!);
        const condNode = node.namedChildren.filter(child => child.type === 'parenthesized_expression').pop();
        return { kind: 'DoWhile', body, cond: this.parseExpression(condNode!), line };
      }
      case 'for_statement': {
        const init = node.childForFieldName('initializer');
        const cond = node.childForFieldName('condition');
        const update = node.childForFieldName('update');
        const body = node.childForFieldName('body');
        let initStatement: Statement | undefined;
        if (init) {
          if (init.type === 'declaration') initStatement = { kind: 'DeclStmt', decls: this.parseTopLevel(init), line };
          else initStatement = { kind: 'ExprStmt', expr: this.parseExpression(init), line: this.lineOfOffset(init.startIndex) };
        }
        return {
          kind: 'For',
          init: initStatement,
          cond: cond ? this.parseExpression(cond) : undefined,
          update: update ? this.parseExpression(update) : undefined,
          body: this.parseStatement(body!),
          line,
        };
      }
      case 'switch_statement': {
        const subject = this.parseExpression(node.childForFieldName('condition')!);
        const bodyNode = node.childForFieldName('body');
        const body = this.parseStatement(bodyNode!) as Extract<Statement, { kind: 'Block' }>;
        return { kind: 'Switch', subject, body, line };
      }
      case 'case_statement': {
        const valueIndex = valueFieldIndex(node, 'value');
        const children = node.namedChildren;
        // tree-sitter uses `case_statement` for `default:` too; it has no value field.
        return {
          kind: valueIndex >= 0 ? 'Case' : 'Default',
          value: valueIndex >= 0 ? this.parseExpression(children[valueIndex]) : undefined,
          body: children.filter((_, index) => index !== valueIndex).map(child => this.parseStatement(child)),
          line,
        };
      }
      case 'labeled_statement': {
        const label = node.namedChildren[0].text.replace(':', '');
        const rest = node.namedChildren[1];
        return { kind: 'Label', name: label, body: rest ? this.parseStatement(rest) : { kind: 'Empty', line }, line };
      }
      case 'break_statement': return { kind: 'Break', line };
      case 'continue_statement': return { kind: 'Continue', line };
      case 'return_statement': {
        const value = node.namedChildren[0];
        return { kind: 'Return', value: value ? this.parseExpression(value) : undefined, line };
      }
      case 'goto_statement': return { kind: 'Goto', name: node.namedChildren[0]?.text ?? '', line };
      case ';': return { kind: 'Empty', line };
      case 'else_clause': {
        // `else` and `else if` are both wrapped in an else_clause node.
        const branch = node.namedChildren[0];
        if (!branch) return { kind: 'Empty', line };
        return this.parseStatement(branch);
      }
      default:
        if (node.namedChildren.length > 0 && /^[a-z_]+_(statement|clause)$/.test(node.type)) return this.parseStatement(node.namedChildren[0]);
        this.fail(node, `暂不支持的语句：${node.type}`);
    }
  }

  private parseFunction(node: Node): FuncDecl {
    const { base, storage } = this.parseDeclarationSpecifier(node);
    const declarator = node.childForFieldName('declarator')!;
    const parsed = this.parseDeclarator(base, declarator);
    if (parsed.type.kind !== 'function') this.fail(node, '函数定义缺少参数列表');
    const body = node.namedChildren.find(child => child.type === 'compound_statement');
    return {
      kind: 'FuncDecl',
      name: parsed.name,
      type: parsed.type,
      storage,
      body: body ? (this.parseStatement(body) as Extract<Statement, { kind: 'Block' }>) : undefined,
      line: this.lineOfOffset(node.startIndex),
    };
  }

  /* ---------- Expressions ---------- */

  private parseExpression(node: Node): Expression {
    const line = this.lineOfOffset(node.startIndex);
    switch (node.type) {
      case 'number_literal': {
        const text = node.text.replace(/'/g, '');
        const hex = /^0[xX]/.test(text);
        if (hex && /[pP.]/.test(text)) this.fail(node, '暂不支持十六进制浮点常量');
        const floating = !hex && /[.eE]/.test(text);
        const suffixPattern = floating ? /[fFlL]$/ : /[uUlL]+$/;
        const suffix = text.match(suffixPattern)?.[0].toLowerCase() ?? '';
        const bare = text.replace(suffixPattern, '');
        let value: number;
        if (/^0[0-7]+$/.test(bare)) value = Number.parseInt(bare, 8);
        else value = Number(bare);
        if (Number.isNaN(value)) this.fail(node, `无法识别的数字：${node.text}`);
        if (!floating && !Number.isSafeInteger(value)) this.fail(node, '整数常量超出教学模型的安全整数范围');
        const type: Type = floating ? (suffix === 'f' ? FLOAT : DOUBLE)
          : suffix.includes('u') ? intType(suffix.includes('ll') ? 64 : suffix.includes('l') || value > 0xffffffff ? 64 : 32, false, suffix.includes('ll') ? 5 : suffix.includes('l') || value > 0xffffffff ? 4 : undefined)
            : suffix.includes('ll') ? intType(64, true, 5) : suffix.includes('l') ? LONG : value <= 0x7fffffff ? INT : hex && value <= 0xffffffff ? UNSIGNED_INT : LONG;
        return { kind: 'Num', value, type, line, raw: node.text };
      }
      case 'char_literal': {
        const raw = node.text;
        const inner = raw.slice(1, -1);
        const value = this.decodeCharBody(inner);
        return { kind: 'Char', value, line, raw };
      }
      case 'string_literal':
      case 'concatenated_string': {
        const bytes = this.decodeStringBody(node.text);
        return { kind: 'Str', bytes, type: pointerTo(CHAR), line };
      }
      case 'identifier': {
        // An enumerator is a compile-time constant, not a variable.
        const constant = this.enumNames.get(node.text);
        if (constant) return { kind: 'Num', value: constant.value, type: INT, line, raw: node.text };
        return { kind: 'Var', name: node.text, line };
      }
      case 'field_identifier': return { kind: 'Var', name: node.text, line };
      case 'parenthesized_expression': return this.parseExpression(node.namedChildren[0]);
      case 'unary_expression': {
        const op = node.childForFieldName('operator')?.text ?? node.namedChildren[0]?.text;
        const operandNode = node.childForFieldName('argument') ?? node.namedChildren[1];
        const operand = this.parseExpression(operandNode);
        if (op === '++' || op === '--') return { kind: 'IncDec', op, operand, prefix: true, line };
        return { kind: 'Unary', op: op as UnaryOp, operand, line };
      }
      case 'pointer_expression': {
        const op = node.childForFieldName('operator')?.text ?? node.namedChildren[0]?.text;
        const operand = this.parseExpression(node.childForFieldName('argument')!);
        return { kind: 'Unary', op: op as UnaryOp, operand, line };
      }
      case 'binary_expression': {
        const op = node.childForFieldName('operator')?.text as BinaryOp;
        const left = this.parseExpression(node.childForFieldName('left')!);
        const right = this.parseExpression(node.childForFieldName('right')!);
        return { kind: 'Binary', op, left, right, type: INT, line };
      }
      case 'assignment_expression': {
        const op = node.childForFieldName('operator')?.text as AssignOp;
        const left = this.parseExpression(node.childForFieldName('left')!);
        const right = this.parseExpression(node.childForFieldName('right')!);
        return { kind: 'Assign', op, target: left, value: right, line };
      }
      case 'conditional_expression': {
        const [cond, then, otherwise] = node.namedChildren;
        return {
          kind: 'Ternary',
          cond: this.parseExpression(cond),
          then: this.parseExpression(then),
          otherwise: this.parseExpression(otherwise),
          line,
        };
      }
      case 'call_expression': {
        const calleeNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        const callee = this.parseExpression(calleeNode!);
        const args = (argsNode?.namedChildren ?? []).map(child => this.parseExpression(child));
        return { kind: 'Call', callee, args, line };
      }
      case 'subscript_expression':
        return {
          kind: 'Index',
          base: this.parseExpression(node.childForFieldName('argument')!),
          index: this.parseExpression(node.childForFieldName('index')!),
          line,
        };
      case 'field_expression': {
        const op = node.childForFieldName('operator')?.text ?? '.';
        const base = this.parseExpression(node.childForFieldName('argument')!);
        const field = node.childForFieldName('field')?.text ?? node.namedChildren[1]?.text ?? '';
        return { kind: 'Member', base, field, arrow: op === '->', line };
      }
      case 'cast_expression': {
        const typeNode = node.childForFieldName('type') ?? node.namedChildren[0];
        const valueNode = node.childForFieldName('value') ?? node.namedChildren[1];
        return { kind: 'Cast', to: parseTypeNode(this, typeNode!), operand: this.parseExpression(valueNode!), line };
      }
      case 'sizeof_expression': {
        const operand = node.namedChildren[0];
        if (operand && isTypeNode(operand)) {
          return { kind: 'SizeofType', type: parseTypeNode(this, operand), line };
        }
        if (!operand) this.fail(node, 'sizeof 缺少操作数');
        return { kind: 'SizeofExpr', operand: this.parseExpression(operand!), line };
      }
      case 'update_expression': {
        const op = node.childForFieldName('operator')?.text as '++' | '--';
        const argument = node.childForFieldName('argument')!;
        const operand = this.parseExpression(argument);
        return { kind: 'IncDec', op, operand, prefix: node.childForFieldName('operator')!.startIndex < argument.startIndex, line };
      }
      case 'comma_expression': {
        const [left, right] = node.namedChildren;
        return { kind: 'Comma', left: this.parseExpression(left), right: this.parseExpression(right), line };
      }
      case 'compound_literal_expression':
        this.fail(node, '暂不支持复合字面量 (compound literal)');
      default:
        this.fail(node, `暂不支持的表达式：${node.type}`);
    }
  }

  private decodeCharBody(body: string): number {
    if (body.startsWith('\\')) {
      const simple: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, 'a': 7, 'b': 8, 'f': 12, 'v': 11, '?': 63 };
      if (simple[body[1]] !== undefined) return simple[body[1]];
      if (/^\\x[0-9a-fA-F]+$/.test(body)) return Number.parseInt(body.slice(2), 16);
      if (/^\\[0-7]+$/.test(body)) return Number.parseInt(body.slice(1), 8);
    }
    return body.codePointAt(0) ?? 0;
  }

  private decodeStringBody(raw: string): number[] {
    const parts = raw.match(/"(?:\\.|[^"\\])*"/g) ?? [];
    const bytes: number[] = [];
    const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };
    for (const part of parts) {
      const inner = part.slice(1, -1);
      let i = 0;
      while (i < inner.length) {
        if (inner[i] !== '\\') {
          bytes.push(inner.charCodeAt(i));
          i += 1;
          continue;
        }
        const hex = /^\\x([0-9a-fA-F]+)/.exec(inner.slice(i));
        if (hex) {
          bytes.push(Number.parseInt(hex[1], 16) & 0xff);
          i += hex[0].length;
          continue;
        }
        const octal = /^\\([0-7]{1,3})/.exec(inner.slice(i));
        if (octal) {
          bytes.push(Number.parseInt(octal[1], 8) & 0xff);
          i += octal[0].length;
          continue;
        }
        bytes.push(escapes[inner[i + 1]] ?? inner.charCodeAt(i + 1));
        i += 2;
      }
    }
    bytes.push(0);
    return bytes;
  }
}

export { sizeOf, alignOf, layoutRecord, typeName };
export type { Param };
