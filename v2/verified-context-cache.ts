/** Pure canonical computation cache; callers must authorize a fresh job read before use. */
import { contentHash, contextStage, stageContext, type CanonicalSnapshot, type TemplateMode } from './rules.ts';

export type VerifiedStageBundle = ReturnType<typeof stageContext>;
export type VerifiedContextProof = Pick<VerifiedStageBundle, 'receipt' | 'conflicts'>;
type ContextOptions = { templateMode?: TemplateMode };
export interface VerifiedContextOperation {
  proof(stage: string, options?: ContextOptions): VerifiedContextProof;
}
const LIMITS = { maxEntries: 16, maxBytes: 8 * 1024 * 1024, ttlMs: 5 * 60_000 } as const;
type Entry = { bundle: VerifiedStageBundle; bytes: number; expiresAt: number };

export class VerifiedContextCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private builds = 0;
  private fingerprints = 0;
  private limits: { maxEntries: number; maxBytes: number; ttlMs: number };
  private now: () => number;

  constructor(options: { maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {}) {
    this.limits = { maxEntries: options.maxEntries ?? LIMITS.maxEntries, maxBytes: options.maxBytes ?? LIMITS.maxBytes, ttlMs: options.ttlMs ?? LIMITS.ttlMs };
    for (const key of ['maxEntries', 'maxBytes', 'ttlMs'] as const)
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > LIMITS[key]) throw new Error('CONTEXT_CACHE_LIMIT');
    this.now = options.now ?? Date.now;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  private prune(now: number) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key);
  }
  private fingerprint(snapshot: CanonicalSnapshot): string {
    this.fingerprints++;
    // Includes packet, registry, conflicts, provenance and unknown future fields.
    // Unlike JSON.stringify hashing, this also rejects non-JSON/unsafe values.
    return contentHash(snapshot);
  }
  private resolve(owner: string, jobId: string, snapshot: CanonicalSnapshot, fingerprint: string, requestedStage: string, options: ContextOptions): VerifiedStageBundle {
    if (!owner || !jobId) throw new Error('CONTEXT_CACHE_SCOPE_REQUIRED');
    const stage = contextStage(requestedStage);
    if (options.templateMode !== undefined && options.templateMode !== 'gtk' && options.templateMode !== 'faq') throw new Error('INVALID_TEMPLATE_MODE');
    const key = JSON.stringify([owner, jobId, fingerprint, stage, options.templateMode ?? null]);
    const now = this.now(); this.prune(now);
    const cached = this.entries.get(key);
    if (cached) {
      this.hits++;
      this.entries.delete(key); this.entries.set(key, cached); // LRU; TTL is not extended.
      return cached.bundle;
    }
    this.misses++;
    // stageContext performs full packet/registry/conflict verification on every miss.
    // An exception never creates a cache entry. Legitimate conflicts stay in the bundle.
    const bundle = stageContext(snapshot, stage, options);
    this.builds++;
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(bundle));
    if (bytes <= this.limits.maxBytes) {
      while (this.entries.size >= this.limits.maxEntries || this.bytes + bytes > this.limits.maxBytes) this.remove(this.entries.keys().next().value!);
      this.entries.set(key, { bundle, bytes, expiresAt: now + this.limits.ttlMs }); this.bytes += bytes;
    }
    return bundle;
  }
  get(owner: string, jobId: string, snapshot: CanonicalSnapshot, stage: string, options: ContextOptions = {}): VerifiedStageBundle {
    return structuredClone(this.resolve(owner, jobId, snapshot, this.fingerprint(snapshot), stage, options));
  }
  proof(owner: string, jobId: string, snapshot: CanonicalSnapshot, stage: string, options: ContextOptions = {}): VerifiedContextProof {
    const bundle = this.resolve(owner, jobId, snapshot, this.fingerprint(snapshot), stage, options);
    return structuredClone({ receipt: bundle.receipt, conflicts: bundle.conflicts });
  }
  /** Use only within one authorized operation; snapshot copying prevents later caller mutation. */
  operation(owner: string, jobId: string, snapshot: CanonicalSnapshot): VerifiedContextOperation {
    const pinned = structuredClone(snapshot);
    let fingerprint: string | undefined;
    return { proof: (stage, options = {}) => {
      fingerprint ??= this.fingerprint(pinned);
      const bundle = this.resolve(owner, jobId, pinned, fingerprint, stage, options);
      return structuredClone({ receipt: bundle.receipt, conflicts: bundle.conflicts });
    } };
  }
  /** Numeric diagnostics only; no owners, job IDs, rule text or cache keys leave the cache. */
  stats() {
    this.prune(this.now());
    return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses, builds: this.builds, fingerprints: this.fingerprints };
  }
}
