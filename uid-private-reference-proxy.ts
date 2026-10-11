import express, { type Express, type Request, type Response } from 'express';
import { digestReference, readBoundedReferenceBytes } from './supabase/functions/_shared/private-reference-access.ts';
import { MAX_PRIVATE_REFERENCE_BYTES, parsePrivateReferenceManifest } from './uid-private-reference-manifest.ts';

const FUNCTION_ORIGIN = 'https://wuonwttmkadwsmefjukv.supabase.co/functions/v1';
const noStore = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
/** A generic authenticated bridge. The exact approved allowlist exists only in the private Edge deployment. */
export function registerPrivateReferenceRoutes(app: Express, fetcher: typeof fetch = fetch) {
  const proxy = (write: boolean, catalog = false) => async (req: Request, res: Response) => {
    res.set(noStore);
    const token = req.header('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 16400) return res.status(401).json({ error: 'AUTHENTICATED_UID_SESSION_REQUIRED' });
    const referenceId = req.params.referenceId;
    if ((!catalog && (typeof referenceId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,119}$/.test(referenceId))) || Object.keys(req.query).length) return res.status(404).json({ error: 'REFERENCE_NOT_FOUND' });
    const mime = req.header('Content-Type') || '';
    if (write && (!Buffer.isBuffer(req.body) || req.body.length < 1 || req.body.length > MAX_PRIVATE_REFERENCE_BYTES || !['image/png', 'image/webp'].includes(mime))) return res.status(400).json({ error: 'EXACT_REFERENCE_BYTES_REQUIRED' });
    try {
      const upstream = await fetcher(`${FUNCTION_ORIGIN}/${write ? 'creative-dna-reference-ingest' : 'creative-dna-references'}${catalog ? '' : '?reference_id=' + encodeURIComponent(referenceId)}`, {
        method: write ? 'POST' : 'GET', headers: { Authorization: token, ...(write ? { 'Content-Type': mime } : {}) },
        body: write ? req.body : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if (!upstream.ok) return res.status([400, 401, 403, 404, 409, 415, 503].includes(upstream.status) ? upstream.status : 502).json({ error: upstream.status === 401 ? 'AUTHENTICATED_UID_SESSION_REQUIRED' : upstream.status === 403 ? 'UID_ACCESS_NOT_GRANTED' : 'PRIVATE_REFERENCE_UNAVAILABLE' });
      if (write || catalog) {
        const bytes = await readBoundedReferenceBytes(upstream.body, 16384);
        if (!bytes) throw new Error('Unexpected metadata');
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (catalog) return res.status(200).json({ schema: 'uid-private-reference-catalog/1', references: parsePrivateReferenceManifest(data) });
        if (!['ALREADY_STORED', 'STORED_AND_VERIFIED', 'STORED_AND_VERIFIED_AFTER_RECHECK'].includes(data.status) || data.reference_id !== referenceId) throw new Error('Unexpected receipt');
        return res.status(upstream.status).json({ status: data.status, reference_id: referenceId });
      }
      const sha256 = upstream.headers.get('X-Content-SHA256') || '', contentType = upstream.headers.get('Content-Type') || '';
      if (!/^[a-f0-9]{64}$/.test(sha256) || !['image/png', 'image/webp'].includes(contentType)) throw new Error('Unexpected reference metadata');
      const bytes = await readBoundedReferenceBytes(upstream.body, MAX_PRIVATE_REFERENCE_BYTES);
      if (!bytes || await digestReference(bytes) !== sha256) throw new Error('Unexpected reference');
      res.set({ 'Content-Type': contentType, 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="${referenceId}.${contentType === 'image/png' ? 'png' : 'webp'}"`, 'X-Content-SHA256': sha256, 'Content-Security-Policy': "default-src 'none'; sandbox" });
      return res.status(200).send(Buffer.from(bytes));
    } catch { return res.status(503).json({ error: 'PRIVATE_REFERENCE_UNAVAILABLE' }); }
  };
  app.get('/api/member/creative-references', proxy(false, true));
  app.get('/api/member/creative-references/:referenceId', proxy(false));
  const rawImage = express.raw({ type: ['image/webp', 'image/png'], limit: '256kb' });
  app.post('/api/admin/creative-references/:referenceId', (req, res, next) => rawImage(req, res, error => {
    if (error) return res.set(noStore).status(error.type === 'entity.too.large' || error.status === 413 ? 413 : 400).json({ error: 'INVALID_REFERENCE_PAYLOAD' });
    next();
  }), proxy(true));
}
