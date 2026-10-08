import { maskComments } from './comments';
import { CSourceError } from './parse';

export interface SourceLocation { file: string; line: number }
interface Token { text: string; location: SourceLocation; space: boolean; hide?: Set<string> }
interface Macro { params?: string[]; variadic: boolean; body: Token[] }
interface Conditional { parent: boolean; active: boolean; taken: boolean; otherwise: boolean }

export class PreprocessError extends Error {
  constructor(message: string, readonly file: string, readonly line: number) { super(`${file}:${line}：${message}`); }
}

const identifier = /^[A-Za-z_]\w*$/;
const tokenPattern = /^(?:L?"(?:\\[\s\S]|[^"\\])*"|L?'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_]\w*|(?:\d|\.\d)(?:[eEpP][+-]|[\w.])*|##|\.\.\.|<<=|>>=|->|\+\+|--|&&|\|\||<<|>>|<=|>=|==|!=|[+\-*/%&|^]=|[^\s])/;

function fail(location: SourceLocation, message: string): never { throw new PreprocessError(message, location.file, location.line); }

function tokenize(source: string, location: SourceLocation): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = location.line;
  while (offset < source.length) {
    const whitespace = source.slice(offset).match(/^\s+/)?.[0] ?? '';
    line += (whitespace.match(/\n/g) ?? []).length;
    offset += whitespace.length;
    if (offset === source.length) break;
    const text = source.slice(offset).match(tokenPattern)?.[0];
    if (!text) fail({ file: location.file, line }, '无法识别预处理记号。');
    tokens.push({ text, location: { file: location.file, line }, space: !!whitespace });
    offset += text.length;
  }
  return tokens;
}

/** Small browser-native preprocessor. Tokens retain invocation locations through expansion. */
export function preprocess(files: Record<string, string>, entry: string): { source: string; locations: SourceLocation[] } {
  const macros = new Map<string, Macro>();
  const once = new Set<string>();
  const output: Token[][] = [];
  const locations: SourceLocation[] = [];
  let work = 0;
  let outputSize = 0;
  const define = (name: string, body: string) => macros.set(name, { variadic: false, body: tokenize(body, { file: entry, line: 1 }) });
  define('__STDC__', '1');
  define('__STDC_VERSION__', '201710L');
  define('__LINE__', '1');
  define('__FILE__', JSON.stringify(entry));
  const reserved = new Set(['__STDC__', '__STDC_VERSION__', '__LINE__', '__FILE__']);

  const expand = (input: Token[], depth = 0): Token[] => {
    if (depth > 80) fail(input[0]?.location ?? { file: entry, line: 1 }, '宏展开层数超过上限。');
    const tokens = input.map(token => ({ ...token }));
    for (let i = 0; i < tokens.length;) {
      const token = tokens[i];
      if (++work > 100000 || tokens.length > 32000) fail(token.location, '宏展开超过教学上限。');
      if (token.text === '__LINE__' || token.text === '__FILE__') {
        token.text = token.text === '__LINE__' ? String(token.location.line) : JSON.stringify(token.location.file);
        i++; continue;
      }
      const macro = macros.get(token.text);
      if (!macro || token.hide?.has(token.text)) { i++; continue; }
      let end = i + 1;
      const raw = new Map<string, Token[]>();
      if (macro.params) {
        if (tokens[end]?.text !== '(') { i++; continue; }
        end++;
        const args: Token[][] = [[]];
        let level = 0;
        for (; end < tokens.length; end++) {
          const text = tokens[end].text;
          if (text === ')' && level === 0) break;
          if (text === ',' && level === 0) args.push([]);
          else {
            args.at(-1)!.push(tokens[end]);
            if (text === '(') level++;
            if (text === ')') level--;
          }
        }
        if (end === tokens.length) fail(token.location, `宏 ${token.text} 的实参缺少右括号。`);
        end++;
        if (!macro.params.length && args.length === 1 && !args[0].length && !macro.variadic) args.pop();
        if ((!macro.variadic && args.length !== macro.params.length) || args.length < macro.params.length) fail(token.location, `宏 ${token.text} 的参数数量不匹配。`);
        macro.params.forEach((name, index) => raw.set(name, args[index]));
        if (macro.variadic) raw.set('__VA_ARGS__', args.slice(macro.params.length).flatMap((arg, index) => index ? [{ ...token, text: ',' }, ...arg] : arg));
      }
      const substituted: Token[] = [];
      for (let b = 0; b < macro.body.length; b++) {
        const part = macro.body[b];
        if (part.text === '#' && macro.params) {
          const argument = raw.get(macro.body[++b]?.text);
          if (!argument) fail(token.location, '# 后面必须是宏参数。');
          const text = argument.map((item, index) => (index && item.space ? ' ' : '') + item.text).join('');
          substituted.push({ ...token, text: JSON.stringify(text) });
        } else if (raw.has(part.text)) {
          const argument = raw.get(part.text)!;
          const pasted = macro.body[b - 1]?.text === '##' || macro.body[b + 1]?.text === '##';
          substituted.push(...(pasted ? (argument.length ? argument : [{ ...token, text: '' }]) : expand(argument, depth + 1)));
        } else substituted.push({ ...part, location: token.location });
      }
      for (let p = 0; p < substituted.length; p++) {
        if (substituted[p].text !== '##') continue;
        if (!p || p === substituted.length - 1) fail(token.location, '## 必须位于两个记号之间。');
        const joined = substituted[p - 1].text + substituted[p + 1].text;
        const combined = tokenize(joined, token.location);
        if (joined && (combined.length !== 1 || combined[0].text !== joined)) fail(token.location, `## 无法拼接为有效记号：${joined}`);
        substituted.splice(p - 1, 3, { ...token, text: joined });
        p--;
      }
      const replacement = substituted.filter(t => t.text).map(part => ({ ...part, hide: new Set([...(part.hide ?? []), ...(token.hide ?? []), token.text]) }));
      tokens.splice(i, end - i, ...replacement);
    }
    return tokens;
  };

  const condition = (text: string, location: SourceLocation): boolean => {
    const tokens = tokenize(text, location);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].text !== 'defined') continue;
      const parenthesized = tokens[i + 1]?.text === '(';
      const name = tokens[i + (parenthesized ? 2 : 1)]?.text;
      if (!name || !identifier.test(name) || parenthesized && tokens[i + 3]?.text !== ')') fail(location, 'defined 需要一个宏名。');
      tokens.splice(i, parenthesized ? 4 : 2, { ...tokens[i], text: macros.has(name) || ['__LINE__', '__FILE__'].includes(name) ? '1' : '0' });
    }
    return evaluateCondition(expand(tokens).map(token => identifier.test(token.text) ? { ...token, text: '0' } : token), location) !== 0n;
  };

  const emit = (tokens: Token[], location: SourceLocation) => {
    outputSize += tokens.reduce((size, token) => size + token.text.length + 1, 1);
    if (outputSize > 128000 || output.length >= 32000) fail(location, '预处理结果超过教学上限。');
    output.push(tokens);
    locations.push(location);
  };

  const include = (file: string, depth = 0) => {
    if (once.has(file)) return;
    if (depth > 40) fail({ file, line: 1 }, '循环包含或头文件嵌套超过上限，请检查头文件保护。');
    const original = files[file];
    if (original === undefined) fail({ file, line: 1 }, `找不到头文件 ${file}。`);
    // C removes backslash-newline before recognizing comments. Keep a physical row map.
    const physical = original.split('\n');
    const logical: string[] = [];
    const rows: number[] = [];
    for (let i = 0; i < physical.length; i++) {
      const row = i + 1;
      let text = physical[i].replace(/\r$/, '');
      while (text.endsWith('\\') && i + 1 < physical.length) text = text.slice(0, -1) + physical[++i].replace(/\r$/, '');
      logical.push(text); rows.push(row);
    }
    let clean: string;
    try { clean = maskComments(logical.join('\n')); }
    catch (error) {
      if (error instanceof CSourceError) fail({ file, line: rows[error.line - 1] }, error.message);
      throw error;
    }
    const state: Conditional[] = [];
    const active = () => state.at(-1)?.active ?? true;
    let pending: Token[] = [];
    const flush = () => {
      if (!pending.length) return;
      const expanded = expand(pending);
      let group: Token[] = [];
      for (const token of expanded) {
        if (group.length && (group[0].location.file !== token.location.file || group[0].location.line !== token.location.line)) {
          emit(group, group[0].location); group = [];
        }
        group.push(token);
      }
      if (group.length) emit(group, group[0].location);
      pending = [];
    };
    for (const [index, line] of clean.split('\n').entries()) {
      const location = { file, line: rows[index] };
      const directive = line.match(/^\s*#\s*(\w*)(.*)$/);
      if (!directive) {
        if (active()) pending.push(...tokenize(line, location).map((token, i) => i === 0 ? { ...token, space: true } : token));
        continue;
      }
      flush();
      const [, command, argument] = directive;
      const arg = argument.trim();
      if (['if', 'ifdef', 'ifndef'].includes(command)) {
        const parent = active();
        if (command !== 'if' && !identifier.test(arg)) fail(location, `${command} 需要一个宏名。`);
        const matches = parent && (command === 'if' ? condition(arg, location) : command === 'ifdef' ? macros.has(arg) : !macros.has(arg));
        state.push({ parent, active: matches, taken: matches, otherwise: false });
      } else if (['elif', 'else', 'endif'].includes(command)) {
        const current = state.at(-1);
        if (!current) fail(location, `${command} 没有对应的 #if。`);
        if (command === 'endif') { if (arg) fail(location, '#endif 后不能有其他记号。'); state.pop(); continue; }
        if (current.otherwise) fail(location, '#else 后不能再有 #elif 或 #else。');
        if (command === 'else' && arg) fail(location, '#else 后不能有其他记号。');
        current.active = current.parent && !current.taken && (command === 'else' || condition(arg, location));
        current.taken ||= current.active;
        current.otherwise = command === 'else';
      } else if (!active()) continue;
      else if (command === 'define') {
        const match = argument.match(/^\s+([A-Za-z_]\w*)(.*)$/);
        if (!match) fail(location, '#define 需要宏名。');
        const [, name, rest] = match;
        if (reserved.has(name)) fail(location, '不能重定义内建宏名。');
        let params: string[] | undefined;
        let body = rest;
        let variadic = false;
        if (rest.startsWith('(')) {
          const end = rest.indexOf(')');
          if (end < 0) fail(location, '宏参数列表未闭合。');
          params = rest.slice(1, end).trim() ? rest.slice(1, end).split(',').map(p => p.trim()) : [];
          variadic = params.at(-1) === '...';
          if (variadic) params.pop();
          if (params.some(p => !identifier.test(p)) || new Set(params).size !== params.length) fail(location, '宏参数名无效或重复。');
          body = rest.slice(end + 1);
        }
        const value = { params, variadic, body: tokenize(body, location) };
        if (value.body[0]?.text === '##' || value.body.at(-1)?.text === '##') fail(location, '## 不能位于宏替换列表的首尾。');
        const prior = macros.get(name);
        if (prior && (JSON.stringify(prior.params) !== JSON.stringify(params) || prior.variadic !== variadic || prior.body.map(t => t.text).join(' ') !== value.body.map(t => t.text).join(' '))) fail(location, `宏 ${name} 重复定义不一致；请先 #undef。`);
        macros.set(name, value);
      } else if (command === 'undef') {
        if (!identifier.test(arg)) fail(location, '#undef 需要一个宏名。');
        if (reserved.has(arg)) fail(location, '不能取消内建宏。');
        macros.delete(arg);
      } else if (command === 'include') {
        const target = expand(tokenize(arg, location)).map(t => t.text).join('');
        const local = target.match(/^"([^"\n]+)"$/)?.[1];
        const system = target.match(/^<([\w]+)\.h>$/)?.[1];
        if (local) {
          if (!Object.hasOwn(files, local)) fail(location, `找不到头文件 ${local}。`);
          include(local, depth + 1);
        } else if (system && ['stdio', 'stdlib', 'string', 'math', 'stdbool', 'stddef', 'stdint', 'limits'].includes(system)) {
          if (['stdio', 'stdlib', 'string', 'stddef'].includes(system)) define('NULL', '((void *)0)');
          if (system === 'stdio') { define('EOF', '(-1)'); define('stdin', '((void *)1)'); }
          if (system === 'stdlib') { define('EXIT_SUCCESS', '0'); define('EXIT_FAILURE', '1'); define('RAND_MAX', '32767'); }
          if (system === 'stdbool') { define('bool', '_Bool'); define('true', '1'); define('false', '0'); }
          if (system === 'limits') { define('CHAR_BIT', '8'); define('INT_MAX', '2147483647'); define('INT_MIN', '(-2147483647 - 1)'); }
          if (['stddef', 'stdlib', 'string', 'stdio'].includes(system)) emit(tokenize('typedef unsigned long size_t;', location), location);
          if (system === 'stdint') emit(tokenize('typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t; typedef int int32_t; typedef unsigned int uint32_t; typedef long int64_t; typedef unsigned long uint64_t;', location), location);
        } else fail(location, `暂不支持的头文件：${target}`);
      } else if (command === 'pragma' && arg === 'once') once.add(file);
      else if (command === 'error') fail(location, `#error ${arg}`);
      else if (command) fail(location, `暂不支持预处理指令 #${command}。`);
    }
    flush();
    if (state.length) fail({ file, line: physical.length }, '条件编译缺少 #endif。');
  };
  include(entry);
  return { source: output.map(tokens => tokens.map(t => t.text).join(' ')).join('\n'), locations };
}

const precedence: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

/** Parse first, evaluate lazily: skipped &&/||/?: operands must not divide by zero. */
function evaluateCondition(tokens: Token[], location: SourceLocation): bigint {
  let cursor = 0;
  type Value = { unsigned: boolean; evaluate: () => bigint };
  const wrap = (value: bigint, unsigned: boolean) => unsigned ? BigInt.asUintN(64, value) : BigInt.asIntN(64, value);
  const expression = (minimum = 0): Value => {
    const token = tokens[cursor++];
    if (!token) fail(location, '#if 缺少整数表达式。');
    let left: Value;
    if (token.text === '(') {
      left = expression();
      if (tokens[cursor++]?.text !== ')') fail(location, '#if 表达式缺少右括号。');
    } else if (['!', '~', '+', '-'].includes(token.text)) {
      const operand = expression(11);
      const unsigned = token.text !== '!' && operand.unsigned;
      left = { unsigned, evaluate: () => {
        const value = operand.evaluate();
        return wrap(token.text === '!' ? BigInt(!value) : token.text === '~' ? ~value : token.text === '-' ? -value : value, unsigned);
      } };
    } else {
      let value: bigint;
      const text = token.text.replace(/[uUlL]+$/, '');
      if (/^(?:0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)$/.test(text)) value = BigInt(/^0[0-7]+$/.test(text) ? `0o${text.slice(1)}` : text);
      else if (/^'(?:[^'\\]|\\[nrt0\\'])'$/.test(text)) {
        const char = text.slice(1, -1);
        value = BigInt(char.startsWith('\\') ? ({ n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39 }[char[1]] ?? 0) : char.charCodeAt(0));
      } else fail(location, `#if 暂不支持此整数记号：${token.text}`);
      if (value > (1n << 64n) - 1n) fail(location, '#if 常量超出 64 位整数范围。');
      left = { unsigned: !token.text.startsWith("'") && /u/i.test(token.text) || value > (1n << 63n) - 1n, evaluate: () => value };
    }
    while (cursor < tokens.length) {
      const op = tokens[cursor].text;
      if (op === '?' && minimum === 0) {
        cursor++;
        const yes = expression();
        if (tokens[cursor++]?.text !== ':') fail(location, '条件表达式缺少冒号。');
        const no = expression();
        const test = left;
        const unsigned = yes.unsigned || no.unsigned;
        left = { unsigned, evaluate: () => wrap(test.evaluate() ? yes.evaluate() : no.evaluate(), unsigned) };
        continue;
      }
      const rank = precedence[op];
      if (!rank || rank < minimum) break;
      cursor++;
      const right = expression(rank + 1);
      const prior = left;
      const comparison = ['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(op);
      const shift = op === '<<' || op === '>>';
      const unsigned = comparison ? false : shift ? prior.unsigned : prior.unsigned || right.unsigned;
      left = { unsigned, evaluate: () => {
        const convertUnsigned = prior.unsigned || right.unsigned;
        const a = wrap(prior.evaluate(), shift ? prior.unsigned : convertUnsigned);
        if (op === '&&') return BigInt(!!a && !!right.evaluate());
        if (op === '||') return BigInt(!!a || !!right.evaluate());
        const b = shift ? right.evaluate() : wrap(right.evaluate(), convertUnsigned);
        if ((op === '/' || op === '%') && b === 0n) fail(location, '#if 表达式除以零。');
        if ((op === '<<' || op === '>>') && (b < 0n || b > 63n)) fail(location, '#if 位移量须在 0–63 之间。');
        switch (op) {
          case '+': return wrap(a + b, unsigned); case '-': return wrap(a - b, unsigned); case '*': return wrap(a * b, unsigned);
          case '/': return wrap(a / b, unsigned); case '%': return wrap(a % b, unsigned);
          case '<<': return wrap(a << b, unsigned); case '>>': return wrap(a >> b, unsigned);
          case '&': return wrap(a & b, unsigned); case '|': return wrap(a | b, unsigned); case '^': return wrap(a ^ b, unsigned);
          case '==': return BigInt(a === b); case '!=': return BigInt(a !== b);
          case '<': return BigInt(a < b); case '<=': return BigInt(a <= b);
          case '>': return BigInt(a > b); case '>=': return BigInt(a >= b);
          default: return 0n;
        }
      } };
    }
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length) fail(location, `#if 表达式中有多余记号：${tokens[cursor].text}`);
  return result.evaluate();
}
