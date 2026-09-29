import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const cloudEnabled = Boolean(url && key);
const client = cloudEnabled ? createClient(url, key) : null;
let cached = null;
const cacheKey = `studenthub:${url}:snapshot`;
try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { /* Storage may be unavailable. */ }
const unwrap = ({ data, error }) => { if (error) throw error; return data; };

async function adminSession() {
  const { session } = unwrap(await client.auth.getSession());
  if (!session) return { admin: null, configured: true };
  const row = unwrap(await client.from('hub_admins').select('user_id').eq('user_id', session.user.id).maybeSingle());
  return { admin: row ? { id: session.user.id, username: session.user.email } : null, configured: true };
}

export async function createPreview(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('PDF must be 15 MB or smaller.');
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const pdf = await task.promise, page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(480 / original.width, 640 / original.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.72));
    if (!blob || blob.size > 262144 || !['image/webp', 'image/jpeg'].includes(blob.type)) throw new Error('Unable to create a small preview for this PDF.');
    return blob;
  } catch (error) { throw new Error(`Could not generate PDF preview: ${error.message}. Use an unencrypted PDF.`); }
  finally { await task.destroy(); }
}

export async function cloudRequest(path, options = {}) {
  if (path === '/api/auth/session') return adminSession();
  if (path === '/api/auth/login') {
    const body = JSON.parse(options.body);
    unwrap(await client.auth.signInWithPassword({ email: body.username.trim(), password: body.password }));
    const session = await adminSession();
    if (!session.admin) { await client.auth.signOut(); throw new Error('This account is not an approved administrator.'); }
    return session;
  }
  if (path === '/api/auth/logout') { unwrap(await client.auth.signOut()); return null; }
  if (path === '/api/hub') {
    const version = unwrap(await client.from('hub_state').select('revision').eq('id', 1).single());
    if (!cached || cached.revision !== version.revision) {
      cached = unwrap(await client.from('hub_state').select('revision,data').eq('id', 1).single());
      try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch { /* Quota/private mode. */ }
    }
    return cached.data;
  }
  const [, , collection, id] = path.split('/');
  const { session } = unwrap(await client.auth.getSession());
  if (!session) throw new Error('Sign in to publish changes.');
  let body;
  if (options.body instanceof FormData) {
    body = options.body;
    body.set('_collection', collection); body.set('_method', options.method); if (id) body.set('_id', id);
    const pdf = body.get('pdf');
    if (pdf instanceof File && pdf.size) body.set('preview', await createPreview(pdf), 'preview.webp');
  } else body = JSON.stringify({ collection, id, method: options.method, body: options.body ? JSON.parse(options.body) : {} });
  const response = await fetch(`${url}/functions/v1/hub`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) }, body });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('hub-session-expired'));
    throw new Error(result.error || 'Unable to save. Please retry.');
  }
  if (result.cleanupPending) window.dispatchEvent(new Event('hub-cleanup-pending'));
  cached = null;
  return result.result;
}
