// C type model for the teaching subset. Sizes and alignment follow the
// x86-64 System V ABI, which is the platform the lessons are written for.
// The engine reports the platform it emulates; it is not a full C ABI.

export type Type =
  | { kind: 'void' }
  | { kind: 'int'; bits: 8 | 16 | 32 | 64; signed: boolean; boolean?: boolean }
  | { kind: 'float'; bits: 32 | 64 }
  | { kind: 'pointer'; to: Type }
  | { kind: 'array'; of: Type; count: number }
  | { kind: 'record'; name: string; tag: 'struct' | 'union'; fields: FieldSpec[]; complete: boolean }
  | { kind: 'enum'; name: string; complete: boolean; base: Type }
  | { kind: 'function'; ret: Type; params: Param[]; variadic: boolean };

export interface Field { name: string; type: Type; offset: number }
/** A field as written in source; its offset comes from the layout pass. */
export type FieldSpec = Omit<Field, 'offset'>;
export interface Param { name: string; type: Type }

export const VOID: Type = { kind: 'void' };

export type IntType = Extract<Type, { kind: 'int' }>;
export type FloatType = Extract<Type, { kind: 'float' }>;
export type PointerType = Extract<Type, { kind: 'pointer' }>;
export type ArrayType = Extract<Type, { kind: 'array' }>;
export type RecordType = Extract<Type, { kind: 'record' }>;
export type EnumType = Extract<Type, { kind: 'enum' }>;
export type FunctionType = Extract<Type, { kind: 'function' }>;

export function isInteger(t: Type): t is IntType | EnumType {
  return t.kind === 'int' || t.kind === 'enum';
}
export function isFloating(t: Type): t is FloatType {
  return t.kind === 'float';
}
export function isArithmetic(t: Type): t is IntType | EnumType | FloatType {
  return isInteger(t) || isFloating(t);
}
export function isPointer(t: Type): t is PointerType {
  return t.kind === 'pointer';
}
export function isArray(t: Type): t is ArrayType {
  return t.kind === 'array';
}
export function isRecord(t: Type): t is RecordType {
  return t.kind === 'record';
}
export function isUnion(t: Type): t is RecordType {
  return t.kind === 'record' && t.tag === 'union';
}
export function isVoid(t: Type): t is { kind: 'void' } {
  return t.kind === 'void';
}
export function isScalar(t: Type): t is IntType | EnumType | FloatType | PointerType {
  return isArithmetic(t) || isPointer(t);
}
export function isAggregate(t: Type): t is ArrayType | RecordType {
  return isArray(t) || isRecord(t);
}
export function isFunction(t: Type): t is FunctionType {
  return t.kind === 'function';
}

export function intType(bits: 8 | 16 | 32 | 64 = 32, signed = true): Type {
  return { kind: 'int', bits, signed };
}
export const INT = intType(32, true);
export const UNSIGNED_INT = intType(32, false);
export const CHAR = intType(8, true);
export const LONG = intType(64, true);
export const UNSIGNED_LONG = intType(64, false);
export const FLOAT = { kind: 'float', bits: 32 } as Type;
export const DOUBLE = { kind: 'float', bits: 64 } as Type;

export function pointerTo(to: Type): Type {
  return { kind: 'pointer', to };
}

/** Size in bytes on the emulated platform. */
function isIntLike(t: Type): t is IntType {
  return t.kind === 'int';
}

export function sizeOf(t: Type): number {
  switch (t.kind) {
    case 'void': return 1;
    case 'int': return t.bits / 8;
    case 'float': return t.bits / 8;
    case 'pointer': return 8;
    case 'enum': return sizeOf(t.base);
    case 'array': return sizeOf(t.of) * t.count;
    case 'record': {
      if (!t.complete) return 0;
      const layout = layoutRecord(t);
      return layout.size;
    }
    case 'function': return 1;
  }
}

export function alignOf(t: Type): number {
  switch (t.kind) {
    case 'array': return alignOf(t.of);
    case 'record': return t.complete ? Math.max(1, ...t.fields.map(f => alignOf(f.type as Type))) : 1;
    case 'enum': return alignOf(t.base);
    case 'function': return 1;
    default: return sizeOf(t);
  }
}

/** Field offsets with padding, matching the C layout rules students can observe. */
export function layoutRecord(t: RecordType): { fields: Field[]; size: number } {
  let offset = 0;
  const fields: Field[] = [];
  for (const field of t.fields) {
    const alignment = alignOf(field.type);
    if (alignment > 1) offset = Math.ceil(offset / alignment) * alignment;
    // C unions overlay every member at offset 0; only structs lay fields out in sequence.
    fields.push({ ...field, offset: t.tag === 'union' ? 0 : offset });
    offset += sizeOf(field.type);
  }
  const structAlign = Math.max(1, ...t.fields.map(f => alignOf(f.type)));
  const size = t.tag === 'union' ? Math.max(0, ...t.fields.map(f => sizeOf(f.type))) : offset;
  const padded = structAlign > 1 ? Math.ceil(size / structAlign) * structAlign : size;
  return { fields, size: padded };
}

export function fieldOffsets(t: RecordType): Map<string, number> {
  return new Map(layoutRecord(t).fields.map(f => [f.name, f.offset]));
}

export function findField(t: Type, name: string): Field | undefined {
  if (t.kind !== 'record') return undefined;
  return layoutRecord(t).fields.find(f => f.name === name);
}

/** Integer promotion: anything narrower than int becomes int before arithmetic. */
export function promote(t: Type): Type {
  if (t.kind === 'enum') return promote(t.base);
  if (t.kind === 'int' && t.bits < 32) return INT;
  return t;
}

export function usualArithmetic(a: Type, b: Type): Type {
  const pa = promote(a);
  const pb = promote(b);
  if (pa.kind === 'float' || pb.kind === 'float') {
    if (pa.kind === 'float' && pa.bits === 64) return DOUBLE;
    if (pb.kind === 'float' && pb.bits === 64) return DOUBLE;
    return FLOAT;
  }
  const ia = (pa.kind === 'int' ? pa : INT) as IntType;
  const ib = (pb.kind === 'int' ? pb : INT) as IntType;
  const rank = (t: { bits: number }): number => (t.bits === 64 ? 2 : t.bits === 32 ? 1 : 0);
  const [hi, lo] = rank(ia) >= rank(ib) ? [ia, ib] : [ib, ia];
  const bits = Math.max(hi.bits, lo.bits) as 32 | 64;
  const signed = hi.signed && lo.signed;
  return { kind: 'int', bits, signed };
}

export function typeName(t: Type): string {
  switch (t.kind) {
    case 'void': return 'void';
    case 'int': return t.boolean ? '_Bool' : `${t.signed ? '' : 'unsigned '}${t.bits === 8 ? 'char' : t.bits === 16 ? 'short' : t.bits === 64 ? 'long' : 'int'}`;
    case 'float': return t.bits === 32 ? 'float' : 'double';
    case 'pointer': return `${typeName(t.to)}*`;
    case 'array': {
      // Declaration order: int a[2][3] reads int[2][3], not the reversed suffix chain.
      const dims: number[] = [];
      let level: Type = t;
      while (level.kind === 'array') { dims.push(level.count); level = level.of; }
      return `${typeName(level)}${dims.map(count => `[${count}]`).join('')}`;
    }
    case 'record': return `${t.tag} ${t.name}`.trim();
    case 'enum': return `enum ${t.name}`;
    case 'function': return `${typeName(t.ret)}(${t.params.map(p => typeName(p.type)).join(', ') || 'void'})`;
  }
}

/** C integer truncation and wrap-around, applied after every arithmetic result. */
export function wrapInteger(value: number, t: Type): number {
  const base = t.kind === 'enum' ? t.base : t;
  if (!isIntLike(base)) return value;
  if (base.boolean) return value === 0 ? 0 : 1;
  const { bits, signed } = base;
  if (bits >= 64) {
    // C wraps unsigned 64-bit at 2^64. JS doubles lose precision past 2^53, so
    // exact wrap uses BigInt; values that large already carry a documented loss.
    if (signed) return value;
    return Number(BigInt.asUintN(64, BigInt(Math.trunc(value))));
  }
  const span = 2 ** bits;
  const wrapped = ((value % span) + span) % span;
  if (signed) {
    const half = span / 2;
    return wrapped >= half ? wrapped - span : wrapped;
  }
  return wrapped;
}

export function integerRange(t: Type): [number, number] {
  const base = t.kind === 'enum' ? t.base : t;
  if (!isIntLike(base)) return [0, 0];
  const { bits, signed } = base;
  if (bits >= 64) return signed ? [-(2 ** 63), 2 ** 63 - 1] : [0, 2 ** 64 - 1];
  const span = 2 ** bits;
  return signed ? [-span / 2, span / 2 - 1] : [0, span - 1];
}
