// Minimal C standard library for the teaching subset, implemented directly so
// the browser has no Node dependencies. Formats match printf semantics closely
// enough for the lessons and report anything they cannot do.

import { CHAR, DOUBLE, FLOAT, INT, VOID, isFloating, isInteger, isPointer, sizeOf, typeName, wrapInteger, type Type } from './types';
import { type Interpreter } from './eval';

export class StdlibError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StdlibError';
  }
}

interface Spec { conversion: string; flags: string; width: number | null; precision: number | null; length: string }

const NATIVE = new Set([
  'printf', 'puts', 'putchar', 'scanf', 'sscanf', 'fgets',
  'strlen', 'strcmp', 'strcpy',
  'strcat', 'strncat', 'strncpy', 'strncmp', 'strchr', 'strstr',
  'memcpy', 'memmove', 'memset', 'memcmp', 'sprintf', 'snprintf',
  'atoi', 'atof', 'rand', 'srand', 'qsort',
  'sqrt', 'pow', 'fabs', 'floor', 'ceil', 'round', 'sin', 'cos', 'tan', 'log', 'exp', 'fmod',
  'malloc', 'calloc', 'free',
  'abs', 'labs', 'exit',
]);

export const isNative = (name: string): boolean => NATIVE.has(name);

export interface NativeResult { value: number; freed?: number }

export function callNative(interp: Interpreter, name: string, args: { type: Type; value: number }[]): NativeResult {
  const a = (index: number) => args[index]?.value ?? 0;
  const count = (index: number) => {
    const value = a(index);
    if (!Number.isInteger(value) || value < 0 || value > interp.memory.size) throw new StdlibError(`${name}() 的字节数超出教学内存范围`);
    return value;
  };
  const byte = (address: number) => interp.memory.readBytes(address, 1)[0];
  switch (name) {
    case 'printf': return { value: format(interp, args, null) };
    case 'sprintf': return { value: format(interp, args.slice(1), a(0)) };
    case 'snprintf': return { value: format(interp, args.slice(2), a(0), count(1)) };
    case 'memcpy': case 'memmove': {
      const bytes = interp.memory.readBytes(a(1), count(2));
      interp.memory.writeBytes(a(0), bytes);
      return { value: a(0) };
    }
    case 'memset': {
      interp.memory.writeBytes(a(0), new Uint8Array(count(2)).fill(a(1) & 255));
      return { value: a(0) };
    }
    case 'memcmp': case 'strncmp': {
      for (let i = 0, n = count(2); i < n; i++) {
        const x = byte(a(0) + i), y = byte(a(1) + i);
        if (x !== y) return { value: x - y };
        if (name === 'strncmp' && !x) break;
      }
      return { value: 0 };
    }
    case 'strncpy': {
      const bytes = new Uint8Array(count(2));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = byte(a(1) + i);
        if (!bytes[i]) break;
      }
      interp.memory.writeBytes(a(0), bytes);
      return { value: a(0) };
    }
    case 'strcat': case 'strncat': {
      const bytes: number[] = [];
      const limit = name === 'strncat' ? count(2) : interp.memory.size;
      for (let i = 0; i < limit; i++) {
        const value = byte(a(1) + i);
        if (!value) break;
        bytes.push(value);
      }
      bytes.push(0);
      interp.memory.writeBytes(a(0) + stringLength(interp, a(0)), Uint8Array.from(bytes));
      return { value: a(0) };
    }
    case 'strchr': {
      for (let i = 0; i < interp.memory.size; i++) {
        const value = byte(a(0) + i);
        if (value === (a(1) & 255)) return { value: a(0) + i };
        if (!value) break;
      }
      return { value: 0 };
    }
    case 'strstr': {
      const index = interp.readRawString(a(0)).indexOf(interp.readRawString(a(1)));
      return { value: index < 0 ? 0 : a(0) + index };
    }
    case 'atoi': return { value: wrapInteger(parseInt(interp.readRawString(a(0)), 10) || 0, INT) };
    case 'atof': return { value: parseFloat(interp.readRawString(a(0))) || 0 };
    case 'srand': interp.randomSeed = a(0) >>> 0; return { value: 0 };
    case 'rand':
      // A reproducible teaching sequence; ISO C does not specify the algorithm.
      interp.randomSeed = (Math.imul(interp.randomSeed, 1103515245) + 12345) >>> 0;
      return { value: (interp.randomSeed >>> 16) & 32767 };
    case 'sqrt': return { value: Math.sqrt(a(0)) };
    case 'pow': return { value: Math.pow(a(0), a(1)) };
    case 'fabs': return { value: Math.abs(a(0)) };
    case 'floor': return { value: Math.floor(a(0)) };
    case 'ceil': return { value: Math.ceil(a(0)) };
    case 'round': return { value: a(0) < 0 ? -Math.round(-a(0)) : Math.round(a(0)) };
    case 'sin': return { value: Math.sin(a(0)) };
    case 'cos': return { value: Math.cos(a(0)) };
    case 'tan': return { value: Math.tan(a(0)) };
    case 'log': return { value: Math.log(a(0)) };
    case 'exp': return { value: Math.exp(a(0)) };
    case 'fmod': return { value: a(0) % a(1) };
    case 'puts': {
      const text = interp.readCString(args[0]?.value ?? 0);
      interp.write(text + '\n');
      return { value: 0 };
    }
    case 'putchar':
      interp.write(String.fromCharCode(args[0]?.value ?? 0));
      return { value: args[0]?.value ?? 0 };
    case 'strlen': return { value: stringLength(interp, args[0]?.value ?? 0) };
    case 'strcmp': return { value: compareStrings(interp, args[0]?.value ?? 0, args[1]?.value ?? 0) };
    case 'strcpy': {
      const bytes = encode(interp.readRawString(args[1]?.value ?? 0));
      interp.memory.writeBytes(args[0]?.value ?? 0, Uint8Array.from(bytes ?? []));
      return { value: args[0]?.value ?? 0 };
    }
    case 'fgets': return { value: fgets(interp, args) };
    case 'abs': return { value: Math.abs(args[0]?.value ?? 0) };
    case 'labs': return { value: Math.abs(args[0]?.value ?? 0) };
    case 'exit': throw new ExitProgram(args[0]?.value ?? 0);
    case 'scanf': return { value: scan(interp, args, interp.scanInput(), true) };
    case 'sscanf': return { value: scan(interp, args.slice(1), interp.readRawString(args[0]?.value ?? 0)) };
    case 'malloc': return { value: interp.heapAllocate(Math.max(1, args[0]?.value ?? 0), `malloc(${args[0]?.value ?? 0})`) };
    case 'calloc': return { value: interp.heapAllocate(Math.max(0, (args[0]?.value ?? 0) * (args[1]?.value ?? 0)), `calloc(${args[0]?.value ?? 0}, ${args[1]?.value ?? 0})`, true) };
    case 'free': {
      const address = args[0]?.value ?? 0;
      if (address === 0) return { value: 0 };
      return { value: 0, freed: interp.heapFree(address) ? address : 0 };
    }
    default:
      throw new StdlibError(`暂不支持的库函数 ${name}()`);
  }
}

export class ExitProgram extends Error {
  constructor(readonly code: number) {
    super('程序退出');
    this.name = 'ExitProgram';
  }
}

function fgets(interp: Interpreter, args: { type: Type; value: number }[]): number {
  const buffer = args[0]?.value ?? 0;
  const size = Math.max(1, args[1]?.value ?? 0);
  const rest = interp.scanInput();
  if (!rest.length) return 0;
  const newline = rest.indexOf('\n');
  const line = rest.slice(0, Math.min(size - 1, newline >= 0 ? newline + 1 : rest.length));
  const bytes = encode(line) ?? [];
  interp.memory.writeBytes(buffer, Uint8Array.from(bytes));
  interp.advanceInput(line.length);
  return buffer;
}

function encode(text: string): number[] | undefined {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) return undefined;
    bytes.push(code);
  }
  bytes.push(0);
  return bytes;
}

function stringLength(interp: Interpreter, address: number): number {
  let length = 0;
  while (interp.memory.readBytes(address + length, 1)[0] !== 0) length++;
  return length;
}

function compareStrings(interp: Interpreter, a: number, b: number): number {
  for (let i = 0; ; i++) {
    const x = interp.memory.readBytes(a + i, 1)[0];
    const y = interp.memory.readBytes(b + i, 1)[0];
    if (x !== y) return x - y;
    if (x === 0) return 0;
  }
}

function parseFormat(format: string): { literals: string[]; spec: Spec | null }[] {
  const parts: { literals: string[]; spec: Spec | null }[] = [];
  let literal = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] !== '%') { literal += format[i++]; continue; }
    let j = i + 1;
    let flags = '';
    while (j < format.length && '-+ #0'.includes(format[j])) flags += format[j++];
    let width = '';
    while (/\d/.test(format[j] ?? '')) width += format[j++];
    let precision = '';
    if (format[j] === '.') {
      j++;
      while (/\d/.test(format[j] ?? '')) precision += format[j++];
    }
    let length = '';
    while (j < format.length && 'hlLzjt'.includes(format[j])) length += format[j++];
    const conversion = format[j++];
    if (conversion === undefined) throw new StdlibError('格式字符串以 % 结尾');
    if (conversion === '%') { literal += '%'; i = j; continue; }
    parts.push({ literals: [literal], spec: { conversion, flags, width: width ? Number(width) : null, precision: precision ? Number(precision) : null, length } });
    literal = '';
    i = j;
  }
  parts.push({ literals: [literal], spec: null });
  return parts;
}

function renderInteger(value: number, spec: Spec): string {
  let body: string;
  switch (spec.conversion) {
    case 'd': case 'i': body = Math.abs(Math.trunc(value)).toString(); break;
    case 'u': body = Math.abs(Math.trunc(value)).toString(); break;
    case 'x': body = Math.abs(Math.trunc(value)).toString(16); break;
    case 'X': body = Math.abs(Math.trunc(value)).toString(16).toUpperCase(); break;
    case 'o': body = Math.abs(Math.trunc(value)).toString(8); break;
    case 'b': body = Math.abs(Math.trunc(value)).toString(2); break;
    case 'c': return String.fromCharCode(value);
    default: throw new StdlibError(`暂不支持的格式符 %${spec.conversion}`);
  }
  const negative = value < 0 && 'diu'.includes(spec.conversion);
  if (negative) body = '-' + body;
  if (spec.conversion === 'x' && spec.flags.includes('#')) body = '0x' + body;
  return pad(body, spec);
}

function pad(body: string, spec: Spec): string {
  if (!spec.width || body.length >= spec.width) return body;
  const fill = spec.flags.includes('0') && !spec.flags.includes('-') ? '0' : ' ';
  return spec.flags.includes('-') ? body + ' '.repeat(spec.width - body.length) : fill.repeat(spec.width - body.length) + body;
}

function renderFloat(value: number, spec: Spec): string {
  const precision = spec.precision ?? 6;
  if (spec.conversion === 'e' || spec.conversion === 'E') {
    return value.toExponential(Math.max(0, precision - 1)).replace(/e([+-])(\d)$/, 'e$10$2');
  }
  if (spec.conversion === 'g' || spec.conversion === 'G') {
    return String(Number(value.toPrecision(Math.max(1, precision))));
  }
  if (!Number.isFinite(value)) {
    // C spells these inf / nan, not Infinity / NaN.
    return pad(Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf', spec);
  }
  if (Math.abs(value) >= 1e21) {
    // Number#toFixed switches to exponential notation past 1e21; C's %f never does.
    // Every double that large is an exact integer, so BigInt prints it exactly.
    const digits = BigInt(Math.abs(value)).toString();
    const body = precision > 0 ? `${digits}.${'0'.repeat(precision)}` : digits;
    return pad((value < 0 ? '-' : '') + body, spec);
  }
  return pad(value.toFixed(Math.max(0, precision)), spec);
}

function format(interp: Interpreter, args: { type: Type; value: number }[], into: number | null, capacity = Infinity): number {
  const formatAddress = args[0]?.value;
  if (formatAddress === undefined) throw new StdlibError('printf 的第一个参数必须是格式字符串');
  const pattern = interp.readRawString(formatAddress);
  const parts = parseFormat(pattern);
  let output = '';
  let argIndex = 1;
  for (const part of parts) {
    output += part.literals.join('');
    if (!part.spec) continue;
    const argument = args[argIndex++];
    if (!argument) throw new StdlibError(`格式字符串需要更多参数：缺少 %${part.spec.conversion}`);
    output += renderArgument(interp, argument, part.spec);
  }
  if (into === null) interp.write(output);
  else if (capacity > 0) interp.memory.writeBytes(into, Uint8Array.from(encode(output.slice(0, capacity - 1)) ?? []));
  return output.length;
}

function renderArgument(interp: Interpreter, argument: { type: Type; value: number }, spec: Spec): string {
  if (spec.conversion === 's') {
    const text = interp.readRawString(argument.value);
    const limited = spec.precision !== null ? text.slice(0, spec.precision) : text;
    return pad(limited, { ...spec, precision: null });
  }
  if (spec.conversion === 'p') {
    return `0x${(argument.value >>> 0).toString(16)}`;
  }
  if ('fFeEgG'.includes(spec.conversion)) return renderFloat(argument.value, spec);
  if (argument.type.kind === 'function' || (isPointer(argument.type) && argument.type.to.kind === 'function')) {
    const entry = interp.functionNameAt(argument.value);
    return entry ? entry : `0x${argument.value.toString(16)}`;
  }
  return renderInteger(argument.value, spec);
}

function scan(interp: Interpreter, args: { type: Type; value: number }[], source: string, consume = false): number {
  const pattern = interp.readRawString(args[0]?.value ?? 0);
  let cursor = 0;
  let matched = 0;
  let argIndex = 1;
  let i = 0;
  let inputFailure = false;
  while (i < pattern.length) {
    const char = pattern[i];
    if (/\s/.test(char)) {
      i++;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
      continue;
    }
    if (char !== '%') {
      if (source[cursor] !== char) { inputFailure = cursor >= source.length; break; }
      cursor++;
      i++;
      continue;
    }
    const spec = /^%(\*)?(\d+)?(hh|ll|h|l|L)?([diuoxXfFeEgGsc%])/.exec(pattern.slice(i));
    if (!spec) throw new StdlibError(`scanf 暂不支持格式：${pattern.slice(i)}`);
    const [, suppress, widthText, length, conversion] = spec;
    const j = i + spec[0].length;
    const width = widthText ? Number(widthText) : conversion === 'c' ? 1 : Infinity;
    if (width <= 0) throw new StdlibError('scanf 字段宽度必须大于零');
    if (conversion === '%') {
      if (source[cursor] === '%') { cursor++; i = j; continue; }
      inputFailure = cursor >= source.length;
      break;
    }
    const target = suppress ? undefined : args[argIndex++];
    if (!suppress && !target) throw new StdlibError('scanf 的参数数量少于格式要求');
    if (conversion !== 'c') while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    if (cursor >= source.length) { inputFailure = true; break; }
    const available = source.slice(cursor, Number.isFinite(width) ? cursor + width : undefined);
    if ('diuoxX'.includes(conversion)) {
      const matcher = conversion === 'i' ? /^[+-]?(?:0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)/ : 'xX'.includes(conversion) ? /^[+-]?(?:0[xX])?[\da-fA-F]+/ : conversion === 'o' ? /^[+-]?[0-7]+/ : /^[+-]?\d+/;
      const match = matcher.exec(available);
      if (!match) break;
      const radix = 'xX'.includes(conversion) || conversion === 'i' && /^[+-]?0x/i.test(match[0]) ? 16 : conversion === 'o' || conversion === 'i' && /^[+-]?0[0-7]/.test(match[0]) ? 8 : 10;
      const type = target && isPointer(target.type) ? target.type.to : INT;
      const value = wrapInteger(parseInt(match[0], radix), type);
      if (target) interp.memory.writeValue(target.value, type, { type, value });
      cursor += match[0].length;
      if (target) matched++;
    } else if ('fFeEgG'.includes(conversion)) {
      const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(available);
      if (!match) break;
      const type = length === 'l' ? DOUBLE : FLOAT;
      if (target) { interp.memory.writeValue(target.value, type, { type, value: Number(match[0]) }); matched++; }
      cursor += match[0].length;
    } else if (conversion === 'c') {
      if (cursor >= source.length) break;
      const text = available;
      if (target) { interp.memory.writeBytes(target.value, Uint8Array.from([...text].map(char => char.charCodeAt(0)))); matched++; }
      cursor += text.length;
    } else if (conversion === 's') {
      const rest = available;
      const stop = rest.search(/\s/);
      const token = stop >= 0 ? rest.slice(0, stop) : rest;
      if (!token) break;
      const bytes = encode(token) ?? [];
      if (target) interp.memory.writeBytes(target.value, Uint8Array.from(bytes));
      cursor += token.length;
      if (target) matched++;
    } else {
      throw new StdlibError(`scanf 暂不支持 %${conversion}`);
    }
    i = j;
  }
  if (consume) interp.advanceInput(cursor);
  return !matched && inputFailure ? -1 : matched;
}

export const stdlibTypes: Record<string, Type> = {};
export { typeName, sizeOf, isInteger, isFloating, isPointer, VOID, FLOAT, DOUBLE };
