// Flat byte memory so that pointers, aliasing, struct fields and arrays behave
// like real C rather than like JavaScript references. Stack grows down from the
// top; the heap starts just above the null page.

import {
  DOUBLE, FLOAT, INT, typeName, sizeOf, wrapInteger,
  type Type,
} from './types';

export const NULL_ADDRESS = 0;
const STACK_TOP = 0x8000;
export const HEAP_START = 0x2000;
const HEAP_LIMIT = 0x7000;

export interface Region { name: 'stack' | 'heap' | 'static' | 'unknown'; label: string; start: number; end: number }

export class Memory {
  private bytes: Uint8Array;
  private stackTop = STACK_TOP;
  private heapNext = HEAP_START;
  private allocations = new Map<number, { size: number; label: string }>();
  private freed = new Set<number>();

  constructor(readonly size = 0x10000) {
    this.bytes = new Uint8Array(size);
  }

  region(address: number): Region {
    if (address >= STACK_TOP) return { name: 'stack', label: '栈', start: STACK_TOP, end: this.size };
    if (address >= HEAP_START) {
      const block = this.allocations.get(address);
      return { name: 'heap', label: '堆', start: address, end: block ? address + block.size : HEAP_LIMIT };
    }
    if (address > 0) return { name: 'static', label: '静态存储', start: 1, end: HEAP_START };
    return { name: 'unknown', label: '空指针', start: 0, end: 0 };
  }

  isAllocated(address: number): boolean {
    return this.allocations.has(address) || address >= STACK_TOP;
  }

  wasFreed(address: number): boolean {
    return this.freed.has(address);
  }

  allocStack(size: number, label: string): number {
    const need = Math.max(1, size);
    this.stackTop -= need;
    this.allocations.set(this.stackTop, { size: need, label });
    return this.stackTop;
  }

  releaseStack(address: number): void {
    const block = this.allocations.get(address);
    this.allocations.delete(address);
    if (block) this.stackTop = Math.max(this.stackTop, address + block.size);
  }

  allocStatic(size: number, label: string): number {
    const address = this.heapNext;
    const need = Math.max(1, size);
    this.heapNext += need;
    this.allocations.set(address, { size: need, label });
    return address;
  }

  allocHeap(size: number, label: string): number | undefined {
    const address = this.heapNext;
    const need = Math.max(1, size);
    if (address + need > HEAP_LIMIT) return undefined;
    this.heapNext += need;
    this.allocations.set(address, { size: need, label });
    this.freed.delete(address);
    return address;
  }

  free(address: number): boolean {
    const block = this.allocations.get(address);
    if (!block || address < HEAP_START) return false;
    this.allocations.delete(address);
    this.freed.add(address);
    return true;
  }

  liveObjects(): { address: number; size: number; label: string }[] {
    return [...this.allocations.entries()]
      .filter(([address]) => address >= HEAP_START)
      .map(([address, block]) => ({ address, size: block.size, label: block.label }));
  }

  contains(address: number, type: Type): boolean {
    if (address === NULL_ADDRESS) return false;
    const size = Math.max(1, sizeOf(type));
    return address >= 0 && address + size <= this.size;
  }

  private assertRange(address: number, length: number): void {
    if (!Number.isInteger(address) || address < 0 || address + length > this.size) {
      throw new Error(`内存访问越界：地址 0x${(address >>> 0).toString(16)}，长度 ${length}`);
    }
  }

  readBytes(address: number, length: number): Uint8Array {
    this.assertRange(address, length);
    return this.bytes.slice(address, address + length);
  }

  writeBytes(address: number, data: Uint8Array): void {
    this.assertRange(address, data.length);
    this.bytes.set(data, address);
  }

  readInteger(address: number, type: Type): number {
    const base = type.kind === 'enum' ? type.base : type;
    if (base.kind !== 'int') throw new Error(`${typeName(type)} 不是整型`);
    const { bits, signed } = base;
    const size = bits / 8;
    this.assertRange(address, size);
    if (bits === 64) {
      // Doubles cannot hold every 64-bit pattern (negative long long accumulates
      // past 2^53): rebuild through BigInt, then surface within the documented
      // safe-integer teaching range.
      const raw = new DataView(this.bytes.buffer, address, 8).getBigInt64(0, true);
      return Number(signed ? raw : BigInt.asUintN(64, raw));
    }
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = value * 256 + this.bytes[address + i];
    return signed ? wrapInteger(value, base) : value;
  }

  writeInteger(address: number, type: Type, value: number): void {
    const base = type.kind === 'enum' ? type.base : type;
    if (base.kind !== 'int') throw new Error(`${typeName(type)} 不是整型，不能直接写入`);
    const { bits } = base;
    const size = bits / 8;
    this.assertRange(address, size);
    let remaining = wrapInteger(value, base);
    for (let i = 0; i < size; i++) {
      this.bytes[address + i] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
  }

  readFloat(address: number, type: Type): number {
    const bits = type.kind === 'float' ? type.bits : 64;
    const size = bits / 8;
    this.assertRange(address, size);
    const view = new DataView(this.bytes.buffer, address, size);
    return bits === 32 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  }

  writeFloat(address: number, type: Type, value: number): void {
    const bits = type.kind === 'float' ? type.bits : 64;
    const size = bits / 8;
    this.assertRange(address, size);
    const view = new DataView(this.bytes.buffer, address, size);
    if (bits === 32) view.setFloat32(0, value, true);
    else view.setFloat64(0, value, true);
  }

  readValue(address: number, type: Type): ScalarValue {
    switch (type.kind) {
      case 'int': return { type, value: this.readInteger(address, type) };
      case 'enum': return { type, value: this.readInteger(address, type.base) };
      case 'float': return { type, value: this.readFloat(address, type) };
      case 'pointer': return { type, value: this.readInteger(address, INT) };
      default: throw new Error(`${typeName(type)} 不是标量`);
    }
  }

  writeValue(address: number, type: Type, value: ScalarValue): void {
    switch (type.kind) {
      case 'int': this.writeInteger(address, type, value.value); return;
      case 'enum': this.writeInteger(address, type.base, value.value); return;
      case 'float': this.writeFloat(address, type, value.value); return;
      case 'pointer': this.writeInteger(address, INT, value.value); return;
      default: throw new Error(`${typeName(type)} 不是标量`);
    }
  }

  zero(address: number, length: number): void {
    this.assertRange(address, length);
    this.bytes.fill(0, address, address + length);
  }
}

export interface ScalarValue { type: Type; value: number }
export interface AggregateValue { kind: 'aggregate'; type: Type; address: number }
export type CValue = ScalarValue | AggregateValue;

export function isAggregateValue(v: CValue): v is AggregateValue {
  return (v as AggregateValue).kind === 'aggregate';
}

/** Byte-wise copy of a whole array or record (initializers and struct assignment). */
export function copyAggregate(memory: Memory, destination: number, source: number, type: Type): void {
  const size = sizeOf(type);
  for (let i = 0; i < size; i++) {
    memory.writeBytes(destination + i, memory.readBytes(source + i, 1));
  }
}