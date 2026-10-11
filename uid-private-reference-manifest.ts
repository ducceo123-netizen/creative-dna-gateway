/** Generic client contract. Real asset metadata is loaded only through authenticated member access. */
export type PrivateReferenceUiRecord = { id: string; filename: string; mime_type: 'image/webp' | 'image/png'; sha256: string; byte_length: number };
export const MAX_PRIVATE_REFERENCE_BYTES = 262144;
export function parsePrivateReferenceManifest(value: unknown): PrivateReferenceUiRecord[] {
  const data = value as any;
  if (data?.schema !== 'uid-private-reference-catalog/1' || !Array.isArray(data.references) || !data.references.length || data.references.length > 16) throw new Error('Invalid private catalog');
  const references: PrivateReferenceUiRecord[] = data.references.map((record: any) => {
    if (!record || !/^[a-z0-9][a-z0-9.-]{0,119}$/.test(record.id) || typeof record.filename !== 'string' || !/^[^/\\\x00-\x1f]{1,160}$/.test(record.filename) ||
      !['image/png', 'image/webp'].includes(record.mime_type) || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isInteger(record.byte_length) || record.byte_length < 1 || record.byte_length > MAX_PRIVATE_REFERENCE_BYTES) throw new Error('Invalid private catalog');
    return { id: record.id, filename: record.filename, mime_type: record.mime_type, sha256: record.sha256, byte_length: record.byte_length } as PrivateReferenceUiRecord;
  });
  if (new Set(references.map(r => r.id)).size !== references.length || new Set(references.map(r => r.filename)).size !== references.length) throw new Error('Duplicate private catalog entry');
  return references;
}
