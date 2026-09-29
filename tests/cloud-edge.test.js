import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformWithOxc } from 'vite';
import { emptyHub } from '../supabase/functions/_shared/model.js';

test('Edge Function authenticates writes, manages files, retries cleanup and recovers failed uploads', async () => {
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno, originalError = console.error;
  const state = { revision: 0, data: emptyHub(), id: 1 }, assets = [], images = new Set(), deleted = [];
  let handler, failDelete = false, failPreview = false, nextId = 0, conflicts = 0;
  const mock = {
    auth: { getUser: async token => ({ data: { user: ['admin','student'].includes(token) ? { id: token } : null }, error: null }) },
    from(table) {
      let action = 'select', values, filters = [], single = false, cap = Infinity, countOnly = false;
      const query = {
        select(_fields, options) { countOnly = !!options?.head; return query; },
        update(v) { action = 'update'; values = v; return query; },
        insert(v) { action = 'insert'; values = v; return query; },
        delete() { action = 'delete'; return query; },
        eq(k, v) { filters.push(row => row[k] === v); return query; },
        lt(k, v) { filters.push(row => row[k] < v); return query; },
        order() { return query; }, limit(n) { cap = n; return query; },
        single() { single = true; return query; }, maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          try {
            const rows = table === 'hub_state' ? [state] : table === 'hub_admins' ? [{ user_id: 'admin' }] : assets;
            if (action === 'insert') rows.push({ state: 'staged', created_at: new Date().toISOString(), ...values });
            const matches = rows.filter(r => filters.every(f => f(r))).slice(0, cap);
            if (action === 'update') matches.forEach(r => Object.assign(r, values));
            if (action === 'delete') matches.forEach(r => rows.splice(rows.indexOf(r), 1));
            resolve({ data: countOnly ? null : structuredClone(single ? matches[0] || null : matches), count: matches.length, error: null });
          } catch (e) { reject(e); }
        }
      };
      return query;
    },
    async rpc(_name, args) {
      if (conflicts-- > 0) return { data: false, error: null };
      if (args.expected !== state.revision) return { data: false, error: null };
      if (args.activate) assets.find(a => a.id === args.activate).state = 'active';
      if (args.retire) assets.find(a => a.id === args.retire).state = 'pending';
      state.data = args.document; state.revision++;
      return { data: true, error: null };
    },
    storage: { from() { return {
      async upload(path) { if (failPreview) return { data: null, error: new Error('Storage unavailable') }; images.add(path); return { data: {}, error: null }; },
      async remove(paths) { paths.forEach(p => images.delete(p)); return { data: {}, error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/previews/${path}` } }; }
    }; } }
  };
  globalThis.__hubTestClient = mock;
  globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: 'https://site.test', CLEANUP_SECRET: 'cleanup-secret', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_FOLDER_ID: 'folder' })[name] }, serve: fn => { handler = fn; } };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'google-token', expires_in: 3600 });
    if (String(url).includes('generateIds')) return Response.json({ ids: [`drive-${++nextId}`] });
    if (options.method === 'DELETE') { if (failDelete) return new Response('', { status: 503 }); deleted.push(String(url).split('/').pop()); }
    return Response.json({});
  };
  console.error = () => {};
  try {
    const source = fs.readFileSync(new URL('../supabase/functions/hub/index.ts', import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source, 'index.ts');
    const code = transformed.code.replace(/import \{ createClient \} from [^;]+;/, 'const createClient = () => globalThis.__hubTestClient;').replace('../_shared/model.js', new URL('../supabase/functions/_shared/model.js', import.meta.url).href);
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const send = (payload, token = 'admin', extra = {}) => handler(new Request('https://test.supabase.co/functions/v1/hub', { method: 'POST', headers: { Origin: 'https://site.test', Authorization: `Bearer ${token}`, ...(payload instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: payload instanceof FormData ? payload : JSON.stringify(payload) }));
    const form = id => { const f = new FormData(); f.set('_collection','assignments'); f.set('_method',id ? 'PUT' : 'POST'); if (id) f.set('_id',id); f.set('title','Homework'); f.set('dueDate','2026-10-01'); f.set('pdf',new Blob(['%PDF-test'],{type:'application/pdf'}),'homework.pdf'); f.set('preview',new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}),'preview.jpg'); return f; };
    assert.equal((await send({}, 'invalid')).status,401);
    assert.equal((await send({}, 'student')).status,403);
    assert.equal((await send({}, 'admin', { Origin: 'https://evil.test' })).status,403);
    assert.equal(assets.length,0);
    let response = await send(form()); assert.equal(response.status,200);
    const first = (await response.json()).result;
    assert.match(first.pdfUrl,/drive-1/); assert.equal(images.size,1); assert.equal(assets[0].state,'active');
    conflicts = 1;
    response = await send({ collection:'announcements', method:'POST', body:{title:'News',body:'Welcome'} });
    assert.equal(response.status,200); assert.equal(state.data.announcements.length,1);
    failDelete = true;
    response = await send(form(first.id)); assert.equal(response.status,200);
    const replacement = await response.json(); assert.equal(replacement.cleanupPending,true);
    assert.equal(assets.find(a=>a.drive_id==='drive-1').state,'pending');
    failDelete = false;
    response = await send({collection:'cleanup'}); assert.equal((await response.json()).result.failed,0);
    assert.ok(deleted.includes('drive-1')); assert.equal(images.size,1);
    response = await send({collection:'assignments',method:'DELETE',id:first.id}); assert.equal(response.status,200);
    assert.equal(state.data.assignments.length,0); assert.equal(images.size,0); assert.ok(deleted.includes('drive-2'));
    failPreview = true;
    response = await send(form()); assert.equal(response.status,500);
    assert.equal(state.data.assignments.length,0); assert.equal(assets[0].state,'pending');
    failPreview = false;
    response = await send({}, '', {'x-cleanup-secret':'cleanup-secret'}); assert.equal(response.status,200);
    assert.equal(assets.length,0); assert.ok(deleted.includes('drive-3'));
  } finally {
    globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; console.error = originalError; delete globalThis.__hubTestClient;
  }
});
