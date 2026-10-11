/** Deployment-only data is injected privately. This repository must contain no real asset metadata. */
export const PRIVATE_REFERENCE_BUCKET = "creative-dna-references";
export type PrivateReference = { id: string; source_library_id: string; source_sha256: string; sha256: string; byte_length: number; mime_type: "image/webp" | "image/png"; filename: string; object_path: string; width: number; height: number };
export const APPROVED_PRIVATE_REFERENCES: readonly PrivateReference[] = [];
