import express, { type Express, type Request, type Response } from 'express';
import { digestReference, readBoundedReferenceBytes } from './supabase/functions/_shared/private-reference-access.ts';
import { decodeLibraryNotes, encodeLibraryNotes, inspectLibraryImage, libraryId, LIBRARY_IMAGE_TYPES, MAX_LIBRARY_IMAGE_BYTES, parseLibraryPage, type LibraryMime } from './supabase/functions/_shared/reference-library-contract.ts';
const FUNCTION_ORIGIN = 'https://wuonwttmkadwsmefjukv.supabase.co/functions/v1';
const noStore = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
/** Authenticated same-origin bridge; no public URLs, browser credentials or caller-selected hosts. */
export function registerPrivateReferenceRoutes(app: Express, fetcher: typeof fetch = fetch) {
  const proxy = (write: boolean, catalog = false) => async (req: Request, res: Response) => {
    res.set(noStore);
    const token = req.header('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 16400) return res.status(401).json({ error: 'AUTHENTICATED_UID_SESSION_REQUIRED' });
    const referenceId = req.params.referenceId;
    const keys = Object.keys(req.query), offset = req.query.offset;
    if ((!catalog && (!libraryId(referenceId) || keys.length)) || (catalog && (keys.some(k => k !== 'offset') || (offset !== undefined && (typeof offset !== 'string' || !/^(0|[1-9]\d{0,6})$/.test(offset) || Number(offset) > 1000000))))) return res.status(404).json({ error: 'REFERENCE_NOT_FOUND' });
    const mime = req.header('Content-Type') || '';
    let metadata = '';
    if (write) {
      try {
        if (!Buffer.isBuffer(req.body)) throw new Error('Invalid bytes');
        inspectLibraryImage(req.body, mime);
        metadata = encodeLibraryNotes(decodeLibraryNotes(req.header('X-Reference-Metadata') || null));
      } catch { return res.status(400).json({ error: 'INVALID_REFERENCE_IMAGE_OR_NOTES' }); }
    }
    try {
      const suffix = catalog ? (offset === undefined ? '' : '?offset=' + offset) : '?reference_id=' + encodeURIComponent(referenceId as string);
      const upstream = await fetcher(`${FUNCTION_ORIGIN}/${write ? 'creative-dna-reference-ingest' : 'creative-dna-references'}${suffix}`, {
        method: write ? 'POST' : 'GET', headers: { Authorization: token, ...(write ? { 'Content-Type': mime, 'X-Reference-Metadata': metadata } : {}) },
        body: write ? req.body : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000),
      });
      if (!upstream.ok) return res.status([400, 401, 403, 404, 409, 413, 415, 503].includes(upstream.status) ? upstream.status : 502).json({ error: upstream.status === 401 ? 'AUTHENTICATED_UID_SESSION_REQUIRED' : upstream.status === 403 ? 'UID_ACCESS_NOT_GRANTED' : 'PRIVATE_REFERENCE_UNAVAILABLE' });
      if (write || catalog) {
        const bytes = await readBoundedReferenceBytes(upstream.body, catalog ? 131072 : 4096);
        if (!bytes) throw new Error('Unexpected metadata');
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (catalog) return res.status(200).json(parseLibraryPage(data));
        if (!['ALREADY_STORED', 'STORED_AND_VERIFIED'].includes(data.status) || data.reference_id !== referenceId) throw new Error('Unexpected receipt');
        return res.status(upstream.status).json({ status: data.status, reference_id: referenceId });
      }
      const sha256 = upstream.headers.get('X-Content-SHA256') || '', contentType = upstream.headers.get('Content-Type') || '';
      if (!/^[a-f0-9]{64}$/.test(sha256) || !LIBRARY_IMAGE_TYPES.includes(contentType as LibraryMime)) throw new Error('Unexpected reference metadata');
      const bytes = await readBoundedReferenceBytes(upstream.body, MAX_LIBRARY_IMAGE_BYTES);
      if (!bytes || await digestReference(bytes) !== sha256) throw new Error('Unexpected reference');
      inspectLibraryImage(bytes, contentType);
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
      res.set({ 'Content-Type': contentType, 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="${referenceId}.${extension}"`, 'X-Content-SHA256': sha256, 'Content-Security-Policy': "default-src 'none'; sandbox" });
      return res.status(200).send(Buffer.from(bytes));
    } catch { return res.status(503).json({ error: 'PRIVATE_REFERENCE_UNAVAILABLE' }); }
  };
  app.get('/api/member/creative-references', proxy(false, true));
  app.get('/api/member/creative-references/:referenceId', proxy(false));
  const rawImage = express.raw({ type: [...LIBRARY_IMAGE_TYPES], limit: MAX_LIBRARY_IMAGE_BYTES });
  app.post('/api/admin/creative-references/:referenceId', (req, res, next) => rawImage(req, res, error => {
    if (error) return res.set(noStore).status(error.type === 'entity.too.large' || error.status === 413 ? 413 : 400).json({ error: 'INVALID_REFERENCE_PAYLOAD' });
    next();
  }), proxy(true));
}
