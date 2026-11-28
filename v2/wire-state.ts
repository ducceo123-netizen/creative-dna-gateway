/** Wire-only state projection. The canonical packet, stored job, gate inputs and
 * original full summary are untouched. Unknown fields are retained by default.
 */
type RecordValue = Record<string, unknown>;

export type CompactStateMetadata = {
  progress: {
    canonicalCompleted: number;
    canonicalTotal: number;
    additionalCompleted: number;
  };
  fullStateAvailable: true;
  fullState: {
    tool: 'onepage_get_state';
    arguments: { jobId: string; detail: 'full' };
  };
};

const states = new Set(['READY', 'BLOCKED', 'RETRYABLE', 'CANCELLED', 'COMPLETE']);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);

/** Accept ordinary JSON records only. Accessors/non-enumerable data/classes are
 * not transport summaries; returning them unchanged avoids losing future data.
 */
function record(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => descriptor.enumerable && 'value' in descriptor);
}

function summary(value: unknown): value is RecordValue & {
  jobId: string; canonicalSteps: string[]; completedSteps: string[]; assets: Record<string, RecordValue>;
} {
  if (!record(value)) return false;
  const required = ['jobId', 'storageRevision', 'contentRevision', 'state', 'stage', 'canonicalSteps', 'completedSteps',
    'canonicalHash', 'blockers', 'conflicts', 'assets', 'approvals', 'expectedSlots', 'nextAction', 'testMode'];
  if (!required.every(key => Object.hasOwn(value, key))) return false;
  if (!text(value.jobId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.jobId)) return false;
  if (!integer(value.storageRevision) || !integer(value.contentRevision) || typeof value.state !== 'string' || !states.has(value.state) || !text(value.stage)) return false;
  if (!digest(value.canonicalHash) || value.testMode !== true || !text(value.nextAction)) return false;
  if (!strings(value.canonicalSteps) || !value.canonicalSteps.length || new Set(value.canonicalSteps).size !== value.canonicalSteps.length) return false;
  if (!strings(value.completedSteps) || new Set(value.completedSteps).size !== value.completedSteps.length) return false;
  // Future hash-addressed transition IDs are not redundant readable step names.
  if (value.canonicalSteps.some(digest) || value.completedSteps.some(digest)) return false;
  if (!strings(value.blockers) || !Array.isArray(value.conflicts) || !Array.isArray(value.approvals) || !strings(value.expectedSlots)) return false;
  if (!record(value.assets)) return false;
  for (const asset of Object.values(value.assets)) {
    if (!record(asset) || !digest(asset.sha256) || !integer(asset.width) || !asset.width || !integer(asset.height) || !asset.height || !text(asset.format)) return false;
  }
  // A future summary may already own these names. Do not overwrite novel data.
  return !['progress', 'fullStateAvailable', 'fullState'].some(key => Object.hasOwn(value, key));
}

/** Remove only reviewed redundant step lists and technical image dimensions.
 * All blockers, conflicts, revisions, hashes, approvals, evidence/reference IDs,
 * QC scopes, expiry, semantic-inspection limits, context identity and unknown
 * fields stay present. Full retrieval uses the existing job authorization.
 * Counts describe recorded transitions; they never imply approval or EO pass.
 */
export function compactState<T>(value: T): T | (RecordValue & CompactStateMetadata) {
  if (!summary(value)) return value;
  const canonical = new Set(value.canonicalSteps);
  const assets = Object.fromEntries(Object.entries(value.assets).map(([slot, asset]) => {
    // Unknown formats may introduce new semantics: retain their entire receipt.
    if (!['png', 'webp'].includes(String(asset.format))) return [slot, asset];
    const copy = { ...asset };
    delete copy.width;
    delete copy.height;
    delete copy.format;
    return [slot, copy];
  }));
  const projected = { ...value, assets } as RecordValue;
  delete projected.canonicalSteps;
  delete projected.completedSteps;
  return {
    ...projected,
    progress: {
      canonicalCompleted: value.completedSteps.filter(step => canonical.has(step)).length,
      canonicalTotal: canonical.size,
      additionalCompleted: value.completedSteps.filter(step => !canonical.has(step)).length,
    },
    fullStateAvailable: true,
    fullState: { tool: 'onepage_get_state', arguments: { jobId: value.jobId, detail: 'full' } },
  };
}
