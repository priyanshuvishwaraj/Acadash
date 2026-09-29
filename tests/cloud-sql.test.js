import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('cloud migration enforces public read-only access, private assets, admin isolation and atomic commits', async () => {
  const db = new PGlite();
  try {
    // Reproduce Supabase roles and schemas, including its permissive default grants,
    // so the migration must explicitly remove unwanted privileges.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
    `);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609290001_cloud_hub.sql',import.meta.url),'utf8'));
    await db.exec(`insert into public.hub_admins values ('00000000-0000-0000-0000-000000000001'); set role anon;`);
    assert.equal((await db.query('select revision from public.hub_state')).rows[0].revision,0);
    await assert.rejects(db.query(`update public.hub_state set revision=99`),/permission denied/);
    await assert.rejects(db.query(`truncate public.hub_state`),/permission denied/);
    await assert.rejects(db.query(`select * from public.hub_assets`),/permission denied/);
    await assert.rejects(db.query(`select public.commit_hub(0,'{}',null,null)`),/permission denied/);
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);`);
    assert.equal((await db.query('select * from public.hub_admins')).rows.length,0);
    await assert.rejects(db.query(`insert into public.hub_admins values ('00000000-0000-0000-0000-000000000002')`),/permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`);
    assert.equal((await db.query('select * from public.hub_admins')).rows.length,1);
    await assert.rejects(db.query(`update public.hub_state set revision=99`),/permission denied/);
    await assert.rejects(db.query(`select public.commit_hub(0,'{}',null,null)`),/permission denied/);
    await db.exec(`reset role; set role service_role;
      insert into public.hub_assets(id,drive_id,preview_path) values
      ('00000000-0000-0000-0000-000000000003','drive-old','old.webp'),
      ('00000000-0000-0000-0000-000000000004','drive-new','new.webp');`);
    assert.equal((await db.query(`select public.commit_hub(0,'{"test":1}','00000000-0000-0000-0000-000000000003',null) as ok`)).rows[0].ok,true);
    assert.equal((await db.query(`select public.commit_hub(0,'{"test":2}',null,null) as ok`)).rows[0].ok,false);
    assert.equal((await db.query(`select data from public.hub_state`)).rows[0].data.test,1);
    await assert.rejects(db.query(`select public.commit_hub(1,'{}','00000000-0000-0000-0000-000000000099',null)`),/Upload expired/);
    assert.equal((await db.query('select revision from public.hub_state')).rows[0].revision,1);
    await db.query(`select public.commit_hub(1,'{"test":2}','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003')`);
    const assets=(await db.query('select drive_id,state from public.hub_assets order by drive_id')).rows;
    assert.deepEqual(assets,[{drive_id:'drive-new',state:'active'},{drive_id:'drive-old',state:'pending'}]);
  } finally { await db.close(); }
});
