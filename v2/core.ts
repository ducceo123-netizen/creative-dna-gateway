import { createHash } from 'node:crypto';

export class V2Error extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}
export function safeJson<T>(value: T, maxBytes = 4 * 1024 * 1024): T {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > maxBytes) throw new V2Error('SIZE_LIMIT', 'JSON payload exceeds the bounded size limit.', 413);
  const parsed = JSON.parse(text);
  const visit = (item: unknown, depth: number) => {
    if (depth > 64) throw new V2Error('DEPTH_LIMIT', 'Payload is too deeply nested.');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new V2Error('UNSAFE_KEY', 'Unsafe object key.');
      visit(child, depth + 1);
    }
  };
  visit(parsed, 0);
  return parsed;
}
export function boundedId(value: string, label = 'identifier'): string {
  if (!/^[A-Za-z0-9_.:@/-]{1,180}$/.test(value) || value.includes('..')) throw new V2Error('INVALID_ID', `Invalid ${label}.`);
  return value;
}
