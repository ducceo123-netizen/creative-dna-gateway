/** Same-response metadata deduplication only. Never use the wire receipt as stored gate evidence. */
import { isDeepStrictEqual } from 'node:util';
import { assertSafeJson, contextStage, type CoverageReceipt, type TemplateMode } from './rules.ts';

export const COVERAGE_REF = '#/coverage' as const;
type CoverageFields = Pick<CoverageReceipt, 'requiredRuleIds' | 'ruleHashes'>;
interface ContextFields {
  schemaVersion: string;
  snapshotHash: string;
  stage: string;
  templateMode: TemplateMode | null;
  data: unknown;
  coverage: CoverageFields;
}
interface FullContext extends ContextFields { receipt: CoverageReceipt }
interface CompactContext extends ContextFields {
  receipt: Omit<CoverageReceipt, keyof CoverageFields> & { coverageRef: typeof COVERAGE_REF };
}
export type CompactStageContext<T extends FullContext> = Omit<T, 'receipt'> & {
  receipt: Omit<T['receipt'], keyof CoverageFields> & { coverageRef: typeof COVERAGE_REF };
};
export type ExpandedStageContext<T extends CompactContext> = Omit<T, 'receipt'> & {
  receipt: Omit<T['receipt'], 'coverageRef'> & CoverageFields;
};

function invalid(reason: string): never { throw new Error('INVALID_WIRE_CONTEXT:' + reason); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validateContext(value: unknown): asserts value is ContextFields & { receipt: Record<string, unknown> } {
  assertSafeJson(value);
  if (!record(value) || value.schemaVersion !== 'uid-brands-v2.stage-context/1' || !record(value.data)
    || !record(value.coverage) || !record(value.receipt)) invalid('CONTEXT_SHAPE');
  const { receipt, coverage } = value;
  if (typeof value.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotHash)
    || typeof receipt.bundleHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.bundleHash)
    || typeof value.stage !== 'string' || contextStage(value.stage) !== value.stage
    || ![null, 'gtk', 'faq'].includes(value.templateMode as TemplateMode | null)
    || receipt.snapshotHash !== value.snapshotHash || receipt.stage !== value.stage
    || receipt.templateMode !== value.templateMode) invalid('RECEIPT_IDENTITY');
  const ids = coverage.requiredRuleIds, hashes = coverage.ruleHashes;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.length)
    || new Set(ids).size !== ids.length || !record(hashes)
    || Object.keys(hashes).length !== ids.length
    || ids.some(id => !Object.hasOwn(hashes, id) || typeof hashes[id] !== 'string'
      || !/^[a-f0-9]{64}$/.test(hashes[id]))) invalid('COVERAGE_SHAPE');
}

/**
 * The original bundle and persisted full receipt are untouched. All rule text, aliases,
 * unknown fields and wrapper metadata remain in this response. The hash still identifies
 * the original canonical bundle; no replacement hash or cross-call cache is introduced.
 */
export function compactStageContext<T extends FullContext>(bundle: T): CompactStageContext<T> {
  validateContext(bundle);
  if (Object.hasOwn(bundle.receipt, 'coverageRef')) invalid('RESERVED_RECEIPT_FIELD');
  if (!isDeepStrictEqual(bundle.receipt.requiredRuleIds, bundle.coverage.requiredRuleIds)
    || !isDeepStrictEqual(bundle.receipt.ruleHashes, bundle.coverage.ruleHashes)) invalid('COVERAGE_MISMATCH');
  const result = structuredClone(bundle) as unknown as CompactStageContext<T>;
  const receipt = result.receipt as Record<string, unknown>;
  delete receipt.requiredRuleIds;
  delete receipt.ruleHashes;
  receipt.coverageRef = COVERAGE_REF;
  return result;
}

/** Resolve only the fixed coverage pointer within this response; never fetch or follow aliases. */
export function expandStageContext<T extends CompactContext>(bundle: T): ExpandedStageContext<T> {
  validateContext(bundle);
  if (bundle.receipt.coverageRef !== COVERAGE_REF
    || Object.hasOwn(bundle.receipt, 'requiredRuleIds') || Object.hasOwn(bundle.receipt, 'ruleHashes')) invalid('COVERAGE_REFERENCE');
  const result = structuredClone(bundle) as unknown as ExpandedStageContext<T>;
  const receipt = result.receipt as Record<string, unknown>;
  delete receipt.coverageRef;
  receipt.requiredRuleIds = structuredClone(bundle.coverage.requiredRuleIds);
  receipt.ruleHashes = structuredClone(bundle.coverage.ruleHashes);
  return result;
}
