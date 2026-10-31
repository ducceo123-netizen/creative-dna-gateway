import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
/** Canonical local relative references must identify the same file in a browser URL. */
export function packagePath(root: string, reference: string) {
  if (typeof reference !== 'string' || !reference || reference.length > 1000 || isAbsolute(reference) || reference.split('/').some(s => !/^[a-zA-Z0-9_.-]+$/.test(s) || s === '.' || s === '..')) throw new Error('UNSAFE_PACKAGE_REFERENCE');
  const path = resolve(root, reference), rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('ASSET_OUTSIDE_PACKAGE');
  return path;
}
async function checkComponents(root: string, path: string) {
  let component = root;
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('PACKAGE_ROOT_CHANGED');
  for (const part of relative(root, path).split(sep)) {
    component = resolve(component, part);
    if ((await lstat(component)).isSymbolicLink()) throw new Error('SYMLINK_ASSET_FORBIDDEN');
  }
  if (await realpath(path) !== path) throw new Error('PACKAGE_PATH_CHANGED');
}
/** All manifest, initial image and final revalidation reads use this same bounded path. */
export async function readBoundedPackageFile(root: string, reference: string, limit: number) {
  const path = packagePath(root, reference);
  await checkComponents(root, path);
  // O_NONBLOCK prevents FIFO/device substitution from hanging before fstat rejects it.
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw new Error('NONREGULAR_OR_OVERSIZE_FILE');
    const bytes = Buffer.alloc(Number(before.size));
    let read = 0;
    while (read < bytes.length) { const result = await fd.read(bytes, read, Math.min(bytes.length-read, 64*1024), read); if (!result.bytesRead) throw new Error('FILE_CHANGED_DURING_READ'); read += result.bytesRead; }
    const after = await fd.stat({ bigint: true });
    await checkComponents(root, path);
    const current = await lstat(path, { bigint: true });
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || current.size !== after.size || current.mtimeNs !== after.mtimeNs) throw new Error('FILE_CHANGED_DURING_READ');
    return bytes;
  } finally { await fd.close(); }
}
