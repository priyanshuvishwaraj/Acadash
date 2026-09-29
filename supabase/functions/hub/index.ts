import { createClient } from 'npm:@supabase/supabase-js@2';
import { fail, mutateHub } from '../_shared/model.js';

const env = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing server setting: ${name}`); return value; };
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) } });
function check<T>(result: { data: T; error: unknown }): T { if (result.error) throw result.error; return result.data; }
let token = '', expires = 0;
async function driveToken() {
  if (token && Date.now() < expires) return token;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }) });
  if (!response.ok) fail('Google Drive connection needs attention. Ask the site owner to reconnect it.', 502);
  const data = await response.json(); token = data.access_token; expires = Date.now() + (data.expires_in - 60) * 1000; return token;
}
async function drive(path: string, options: RequestInit = {}, upload = false) {
  const response = await fetch(`https://www.googleapis.com/${upload ? 'upload/' : ''}drive/v3/${path}`, { ...options, signal: AbortSignal.timeout(upload ? 60000 : 10000), headers: { ...options.headers, Authorization: `Bearer ${await driveToken()}` } });
  if (!response.ok && !(options.method === 'DELETE' && response.status === 404)) fail(`Google Drive request failed (${response.status}). Please retry.`, 502);
  return response;
}
async function cleanPending() {
  // Recover interrupted uploads, but never touch active attachments.
  check(await db.from('hub_assets').update({ state: 'pending' }).eq('state', 'staged').lt('created_at', new Date(Date.now() - 86400000).toISOString()));
  const rows = check(await db.from('hub_assets').select('*').eq('state', 'pending').order('created_at').limit(5));
  const deadline = Date.now() + 20000;
  for (const asset of rows || []) {
    if (Date.now() > deadline) break;
    try {
      await drive(`files/${encodeURIComponent(asset.drive_id)}`, { method: 'DELETE' });
      check(await db.storage.from('previews').remove([asset.preview_path]));
      check(await db.from('hub_assets').delete().eq('id', asset.id).eq('state', 'pending'));
    } catch (error) {
      await db.from('hub_assets').update({ last_error: String(error).slice(0, 500) }).eq('id', asset.id);
    }
  }
  const pending = await db.from('hub_assets').select('id', { count: 'exact', head: true }).eq('state', 'pending');
  check(pending);
  return pending.count || 0;
}
async function uploadAsset(pdf: File, preview: File | null) {
  if (pdf.size > 15 * 1024 * 1024 || pdf.size < 5 || !pdf.name.toLowerCase().endsWith('.pdf') || new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer()) !== '%PDF-') fail('Attach a valid PDF up to 15 MB.');
  if (!preview || preview.size > 262144 || !['image/webp','image/jpeg'].includes(preview.type)) fail('A preview image up to 256 KB is required.');
  const bytes = new Uint8Array(await preview.slice(0, 12).arrayBuffer());
  const valid = preview.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid) fail('Invalid preview image.');
  // Reserve a Drive ID first so even a worker interruption leaves a recoverable record.
  const ids = await (await drive('files/generateIds?count=1&space=drive&type=files')).json();
  const id = crypto.randomUUID(), driveId = ids.ids[0], previewPath = `${id}.${preview.type === 'image/webp' ? 'webp' : 'jpg'}`;
  check(await db.from('hub_assets').insert({ id, drive_id: driveId, preview_path: previewPath }));
  try {
    const boundary = `hub_${id}`;
    const metadata = { id: driveId, name: pdf.name.slice(0, 200), parents: [env('GOOGLE_DRIVE_FOLDER_ID')] };
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, pdf, `\r\n--${boundary}--`]);
    await drive('files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, true);
    await drive(`files/${driveId}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }) });
    check(await db.storage.from('previews').upload(previewPath, preview, { contentType: preview.type, cacheControl: '31536000' }));
    return { assetId: id, pdfUrl: `https://drive.google.com/file/d/${driveId}/view`, previewUrl: db.storage.from('previews').getPublicUrl(previewPath).data.publicUrl, originalFileName: pdf.name.slice(0, 200) };
  } catch (error) {
    await db.from('hub_assets').update({ state: 'pending' }).eq('id', id).eq('state', 'staged');
    throw error;
  }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim());
  const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : '', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cleanup-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  let attachment: Awaited<ReturnType<typeof uploadAsset>> | null = null;
  try {
    if (request.method !== 'POST') fail('Method not allowed.', 405);
    if (origin && !allowed.includes(origin)) fail('Origin not allowed.', 403);
    const cleanupSecret = Deno.env.get('CLEANUP_SECRET');
    if (cleanupSecret && request.headers.get('x-cleanup-secret') === cleanupSecret) return reply({ failed: await cleanPending() });
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
    const { data: auth, error } = await db.auth.getUser(bearer);
    if (error || !auth.user) fail('Sign in again.', 401);
    const admin = check(await db.from('hub_admins').select('user_id').eq('user_id', auth.user.id).maybeSingle());
    if (!admin) fail('Administrator access required.', 403);
    if (Number(request.headers.get('content-length') || 0) > 17 * 1024 * 1024) fail('Upload is too large.', 413);
    let collection: string, method: string, id: string | undefined, body: Record<string, unknown>, pdf: File | null = null, preview: File | null = null;
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      collection = String(form.get('_collection')); method = String(form.get('_method')); id = String(form.get('_id') || '') || undefined;
      body = Object.fromEntries([...form.entries()].filter(([key, value]) => !key.startsWith('_') && typeof value === 'string'));
      const file = form.get('pdf'), image = form.get('preview'); pdf = file instanceof File ? file : null; preview = image instanceof File ? image : null;
    } else {
      ({ collection, method, id, body = {} } = await request.json());
    }
    if (collection === 'cleanup') { const failed = await cleanPending(); return reply({ result: { failed }, cleanupPending: failed > 0 }); }
    if (pdf && (!['assignments','resources'].includes(collection) || !['POST','PUT'].includes(method))) fail('Unexpected attachment.');
    // Validate the form before allocating storage. A placeholder is replaced by trusted upload metadata.
    const initial = check(await db.from('hub_state').select('data').eq('id', 1).single());
    if (!initial) fail('The hub database is not initialized.', 503);
    mutateHub(initial.data, collection, method, id, body, pdf ? { pdfUrl: 'pending' } : null);
    if (pdf) attachment = await uploadAsset(pdf, preview);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = check(await db.from('hub_state').select('revision,data').eq('id', 1).single());
      if (!current) fail('The hub database is not initialized.', 503);
      const change = mutateHub(current.data, collection, method, id, body, attachment);
      const committed = check(await db.rpc('commit_hub', { expected: current.revision, document: change.hub, activate: attachment?.assetId || null, retire: change.retired }));
      if (committed) {
        attachment = null;
        const failed = await cleanPending().catch(() => 1);
        return reply({ result: change.result, cleanupPending: failed > 0 });
      }
    }
    fail('Another administrator is editing. Please retry.', 409);
  } catch (error) {
    if (attachment) await db.from('hub_assets').update({ state: 'pending' }).eq('id', attachment.assetId).eq('state', 'staged');
    const status = (error as { status?: number }).status || 500;
    console.error('Hub request failed:', (error as Error).message);
    return reply({ error: status === 500 ? 'Unable to save this change. Please retry or contact the site owner.' : (error as Error).message }, status);
  }
});
