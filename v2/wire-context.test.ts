import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCoverage, contentHash, createSnapshot, OBSERVED_EXECUTION, stageContext, type Packet } from './rules.ts';
import { compactStageContext, expandStageContext, COVERAGE_REF } from './wire-context.ts';

function fixture() {
  const packet: Packet = {
    resolved: { brand: 'pawfecthouse', branch: 'onepage-system' }, assets: [],
    execution: [...OBSERVED_EXECUTION], hard_gates: { physical_truth: 'HARD' },
    creative_quality_contract: { status: 'COMPILED', errors: [], revision: 'synthetic:wire-1', rules: [
      { id: 'synthetic:hard', instruction: 'Exact café rule.\nKeep all required visible text.', sources: [{ locator: 'synthetic-fixture' }], scope: { brands: ['pawfecthouse'] }, requires: ['synthetic:dependency'], unknown_rule_metadata: { retained: true } },
      { id: 'synthetic:dependency', instruction: 'Required dependency remains verbatim.', sources: [{ locator: 'synthetic-fixture' }], scope: { brands: ['pawfecthouse'] } },
    ] },
    ui_mapping_templates: {
      gtk: { version: 'synthetic-gtk', future_instruction: { text: 'Unknown template instruction remains visible.' } },
      faq: { version: 'synthetic-faq', future_instruction: { text: 'Unknown template instruction remains visible.' } },
    },
    unknown_future_contract: { instruction: 'Unknown scope must stay visible.', nested: [null, 'exact', { future: true }] },
  };
  return createSnapshot(packet, { sourceUrl: 'synthetic:wire-context', observedAt: '2026-11-28T00:00:00Z', baselineCommit: '0'.repeat(40), visibility: 'synthetic' });
}

test('wire receipt roundtrip preserves canonical hash, every stage rule and persisted coverage evidence', () => {
  const snapshot = fixture();
  for (const step of OBSERVED_EXECUTION) {
    const original = stageContext(snapshot, step, { templateMode: 'gtk' });
    const before = structuredClone(original), storedReceipt = structuredClone(original.receipt);
    const wire = compactStageContext(original), expanded = expandStageContext(wire);
    assert.deepEqual(original, before);
    assert.deepEqual(expanded, original);
    assert.equal(wire.receipt.coverageRef, COVERAGE_REF);
    assert.equal(Object.hasOwn(wire.receipt, 'requiredRuleIds'), false);
    assert.equal(Object.hasOwn(wire.receipt, 'ruleHashes'), false);
    const { receipt, ...base } = expanded;
    assert.equal(contentHash(base), original.receipt.bundleHash);
    assert.equal(receipt.bundleHash, original.receipt.bundleHash);
    assert.deepEqual(wire.data, original.data);
    assert.deepEqual(wire.templateContextRecords, original.templateContextRecords);
    assert.deepEqual(wire.coverage, original.coverage);
    assert.deepEqual(wire.aliases, original.aliases);
    assert.deepEqual(wire.data.unknown_future_contract, snapshot.packet.unknown_future_contract);
    assert.deepEqual(wire.data.creative_quality_contract.rules, snapshot.packet.creative_quality_contract.rules);
    assert.equal(assertCoverage(snapshot, step, storedReceipt, { templateMode: 'gtk' }).status, 'COVERED');
    assert.equal(assertCoverage(snapshot, step, expanded.receipt, { templateMode: 'gtk' }).status, 'COVERED');
    assert.throws(() => assertCoverage(snapshot, step, wire.receipt as any, { templateMode: 'gtk' }), /STALE_OR_INCOMPLETE/);
    assert.ok(Buffer.byteLength(JSON.stringify(wire)) < Buffer.byteLength(JSON.stringify(original)));
  }
});

test('wrapper and future metadata survive unchanged; compact and expanded copies share no mutable state', () => {
  const canonical = stageContext(fixture(), 'research');
  const original = { ...canonical, jobId: 'synthetic-job', storageRevision: 7,
    futureWrapper: { nested: ['verbatim', { value: 42 }] },
    coverage: { ...canonical.coverage, futureCoverage: { keep: true } },
    receipt: { ...canonical.receipt, futureReceipt: { keep: ['all metadata'] } },
    access: { mode: 'public-test', identityVerified: false },
  };
  const before = structuredClone(original), wire = compactStageContext(original), expanded = expandStageContext(wire);
  assert.deepEqual(expanded, before);
  assert.equal(expanded.receipt.bundleHash, canonical.receipt.bundleHash);
  wire.futureWrapper.nested.push('wire-only');
  wire.coverage.requiredRuleIds.push('wire-only');
  wire.receipt.futureReceipt.keep.push('wire-only');
  assert.deepEqual(original, before);
  assert.deepEqual(expanded, before);
});

test('mismatched duplicated metadata, reserved fields and malformed coverage fail closed without mutation', () => {
  const original = stageContext(fixture(), 'research');
  const cases: Array<(value: any) => void> = [
    value => { value.receipt.requiredRuleIds = []; },
    value => { value.receipt.requiredRuleIds = [...value.receipt.requiredRuleIds].reverse(); },
    value => { value.receipt.ruleHashes = { ...value.receipt.ruleHashes, 'synthetic:hard': '0'.repeat(64) }; },
    value => { value.receipt.snapshotHash = '0'.repeat(64); },
    value => { value.receipt.stage = 'content'; },
    value => { value.receipt.templateMode = 'gtk'; },
    value => { value.receipt.bundleHash = 'not-a-hash'; },
    value => { value.receipt.coverageRef = '#/coverage'; },
    value => { value.coverage.requiredRuleIds.push(value.coverage.requiredRuleIds[0]); },
    value => { value.coverage.ruleHashes.extra = '0'.repeat(64); },
    value => { value.data = null; },
    value => { value.schemaVersion = 'future'; },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(original); mutate(candidate); const before = structuredClone(candidate);
    assert.throws(() => compactStageContext(candidate), /INVALID_WIRE_CONTEXT/);
    assert.deepEqual(candidate, before);
  }
});

test('expansion accepts only complete same-response coverage and fixed local pointer', () => {
  const wire = compactStageContext(stageContext(fixture(), 'research'));
  const cases: Array<(value: any) => void> = [
    value => { value.receipt.coverageRef = 'https://example.com/coverage'; },
    value => { value.receipt.coverageRef = '#/other'; },
    value => { delete value.coverage; },
    value => { delete value.coverage.ruleHashes; },
    value => { value.receipt.requiredRuleIds = value.coverage.requiredRuleIds; },
    value => { value.receipt.ruleHashes = value.coverage.ruleHashes; },
    value => { value.receipt.snapshotHash = '0'.repeat(64); },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(wire); mutate(candidate); const before = structuredClone(candidate);
    assert.throws(() => expandStageContext(candidate), /INVALID_WIRE_CONTEXT/);
    assert.deepEqual(candidate, before);
  }
  const unsafe = JSON.parse(JSON.stringify(wire));
  unsafe.extra = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => expandStageContext(unsafe), /UNSAFE_JSON_KEY/);
});
