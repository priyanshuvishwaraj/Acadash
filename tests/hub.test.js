import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { hashPassword } from '../server/auth.js';

test('shared hub: migration, public reads, admin permissions, validation and restart persistence',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'campus-hub-test-'));
  const options={databasePath:path.join(temp,'hub.sqlite'),legacyPath:path.join(temp,'db.json'),uploadDir:path.join(temp,'uploads')};
  const legacy={schedule:[{id:'class-1',day:1,start:'09:00',end:'10:00',subject:'Mathematics',room:'B-204'}],assignments:[{id:'assignment-1',title:'Existing assignment',subject:'Maths',dueDate:'2026-09-28',description:'Retained',pdfUrl:'/uploads/existing.pdf',originalFileName:'existing.pdf',createdAt:'2026-09-25T00:00:00Z'}],events:[{id:'event-1',title:'Existing test',date:'2026-09-28',type:'test',description:''}],announcements:[]};
  fs.writeFileSync(options.legacyPath,JSON.stringify(legacy));
  let active,server,base,cookie;
  async function start() { active=createApp(options);server=active.app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`; }
  async function stop() {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));active.store.close()}
  await start();
  t.after(async()=>{await stop();fs.rmSync(temp,{recursive:true,force:true})});
  const get=async route=>(await fetch(`${base}/api/${route}`)).json();
  const send=(route,body,{method='POST',auth=true,origin}={})=>fetch(`${base}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(auth && cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  await t.test('imports existing data once and permits anonymous browsing',async()=>{
    const hub=await get('hub');
    assert.deepEqual(hub.schedule,legacy.schedule.map(row=>({...row,color:"coral",courseId:null,professor:"",classType:""})));assert.deepEqual(hub.assignments,legacy.assignments.map(row=>({...row,courseId:null,submissionUrl:"",closed:0})));
    assert.equal(hub.events[0].startTime,'');assert.equal(hub.events[0].type,'test');
    assert.equal((await get('auth/session')).configured,false);
    assert.equal((await fetch(`${base}/api/schedule/render`)).status,200);
    assert.equal((await get('health')).database,'sqlite');
  });
  await t.test('rejects all anonymous writes before handling uploads',async()=>{
    for(const route of ['announcements','events','assignments']) {
      assert.equal((await send(route,{}, {auth:false})).status,401);
      assert.equal((await send(`${route}/any`,{}, {method:'PUT',auth:false})).status,401);
      assert.equal((await send(`${route}/any`,{}, {method:'DELETE',auth:false})).status,401);
    }
    assert.equal((await send('schedule',{entries:[],revision:0},{method:'PUT',auth:false})).status,401);
    const form=new FormData();form.append('pdf',new Blob(['%PDF-1.4\n'],{type:'application/pdf'}),'private.pdf');
    assert.equal((await fetch(`${base}/api/assignments`,{method:'POST',body:form})).status,401);
    assert.deepEqual(fs.readdirSync(options.uploadDir),[]);
  });
  await t.test('authenticates securely and refuses cross-origin changes',async()=>{
    active.store.db.prepare('INSERT INTO administrators VALUES (?,?,?)').run('admin-1','class-rep',hashPassword('testing-password-123'));
    assert.equal((await send('auth/login',{username:'class-rep',password:'wrong'})).status,401);
    const response=await send('auth/login',{username:'class-rep',password:'testing-password-123'});
    assert.equal(response.status,200);const header=response.headers.get('set-cookie');
    assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=Strict/i);cookie=header.split(';')[0];
    assert.equal((await (await fetch(`${base}/api/auth/session`,{headers:{Cookie:cookie}})).json()).admin.username,'class-rep');
    assert.equal((await send('announcements',{title:'Bad origin',body:'Not saved'},{origin:'https://unrelated.example'})).status,403);
    assert.equal(active.store.list('announcements').length,0);
  });
  let announcement,event,assignment;
  await t.test('publishes notices and timed events visible to anonymous students',async()=>{
    let response=await send('announcements',{title:'Exam update',body:'The exam is in the main hall.'});assert.equal(response.status,201);announcement=await response.json();
    response=await send('events',{title:'Mathematics exam',date:'2026-10-02',type:'exam',startTime:'09:30',endTime:'11:00',location:'Main hall',description:'Chapters 1–3'});assert.equal(response.status,201);event=await response.json();
    const hub=await get('hub');assert.equal(hub.announcements[0].id,announcement.id);assert.equal(hub.events.find(x=>x.id===event.id).startTime,'09:30');assert.equal(hub.events.find(x=>x.id===event.id).location,'Main hall');
    response=await send('events',{title:'Test',date:'2026-10-04',type:'test'});assert.equal(response.status,201);
    for(const payload of [{title:'Invalid',date:'2026-02-30'},{title:'Invalid',date:'2026-10-02',startTime:'11:00',endTime:'09:00'},{title:'Invalid',date:'2026-10-02',endTime:'10:00'},{title:'Invalid',date:'2026-10-02',type:'unknown'},{title:' ',date:'2026-10-02'}]) assert.equal((await send('events',payload)).status,400);
    assert.equal((await send('announcements',{title:' ',body:'No title'})).status,400);
  });
  await t.test('validates PDFs and serves uploaded assignments to other students',async()=>{
    function form(content,title='Problem set') {const data=new FormData();data.append('title',title);data.append('subject','Maths');data.append('dueDate','2026-10-05');data.append('pdf',new Blob([content],{type:'application/pdf'}),'assignment.pdf');return data}
    let response=await fetch(`${base}/api/assignments`,{method:'POST',headers:{Cookie:cookie},body:form('not a pdf')});assert.equal(response.status,400);assert.deepEqual(fs.readdirSync(options.uploadDir),[]);
    response=await fetch(`${base}/api/assignments`,{method:'POST',headers:{Cookie:cookie},body:form('%PDF-1.4\n%%EOF',' ')});assert.equal(response.status,400);assert.deepEqual(fs.readdirSync(options.uploadDir),[]);
    response=await fetch(`${base}/api/assignments`,{method:'POST',headers:{Cookie:cookie},body:form('%PDF-1.4\n%%EOF')});assert.equal(response.status,201);assignment=await response.json();
    assert.equal((await fetch(`${base}${assignment.pdfUrl}`)).status,200);assert.ok((await get('assignments')).some(a=>a.id===assignment.id));
  });
  await t.test('administrators can correct notices, event timing and assignment details',async()=>{
    let response=await send(`announcements/${announcement.id}`,{title:'Updated exam notice',body:'Now in room B-204.'},{method:'PUT'});
    assert.equal(response.status,200);assert.equal((await response.json()).createdAt,announcement.createdAt);
    response=await send(`events/${event.id}`,{...event,startTime:'10:00',endTime:'12:00',location:'B-204'},{method:'PUT'});
    assert.equal(response.status,200);assert.equal((await response.json()).startTime,'10:00');
    const form=new FormData();form.append('title','Revised problem set');form.append('subject','Maths');form.append('dueDate','2026-10-06');
    response=await fetch(`${base}/api/assignments/${assignment.id}`,{method:'PUT',headers:{Cookie:cookie},body:form});
    assert.equal(response.status,200);const edited=await response.json();assert.equal(edited.pdfUrl,assignment.pdfUrl);assert.equal(edited.dueDate,'2026-10-06');
    const hub=await get('hub');assert.equal(hub.events.find(e=>e.id===event.id).location,'B-204');assert.equal(hub.announcements[0].title,'Updated exam notice');
  });
  await t.test('timetable uses atomic transactions and rejects stale administrator edits',async()=>{
    const entries=[...legacy.schedule,{id:'class-2',day:2,start:'10:00',end:'11:00',subject:'Physics',room:'Lab'}];
    const responses=await Promise.all([send('schedule',{entries,revision:0},{method:'PUT'}),send('schedule',{entries:[],revision:0},{method:'PUT'})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const snapshot=await get('hub');assert.equal(snapshot.scheduleRevision,1);
    const prior=snapshot.schedule;
    const duplicateIds=[{id:'same',day:1,start:'08:00',end:'09:00',subject:'A',room:''},{id:'same',day:2,start:'08:00',end:'09:00',subject:'B',room:''}];
    assert.throws(()=>active.store.replaceSchedule(duplicateIds,1));
    assert.deepEqual((await get('hub')).schedule,prior);assert.equal(active.store.revision(),1);
  });
  await t.test('saves class colors, renders the latest data and validates college hours',async()=>{
    const revision=active.store.revision();
    const entry={id:'color-class',day:1,start:'17:00',end:'18:00',subject:'Evening lab',room:'A',color:'purple'};
    assert.equal((await send('schedule',{entries:[entry],revision},{method:'PUT'})).status,200);
    assert.equal((await get('hub')).schedule[0].color,'purple');
    const image=await (await fetch(`${base}/api/schedule/render`)).text();
    assert.match(image,/Evening lab/);assert.match(image,/#efe5fc/);
    for(const changes of [{start:'07:00'},{end:'19:00'},{color:'invalid'}]) assert.equal((await send('schedule',{entries:[{...entry,...changes}],revision:revision+1},{method:'PUT'})).status,400);
    assert.equal((await send('schedule',{entries:[entry,{...entry,id:'overlap',start:'17:30'}],revision:revision+1},{method:'PUT'})).status,400);
  });
  await t.test('persists across restarts without re-importing legacy data',async()=>{
    await stop();await start();
    assert.ok((await get('announcements')).some(x=>x.id===announcement.id));assert.ok((await get('assignments')).some(x=>x.id===assignment.id));
    assert.equal((await get('events')).filter(x=>x.id==='event-1').length,1);
    assert.equal(active.store.revision(),2);
    assert.equal((await get('hub')).schedule[0].color,'purple');
    assert.equal((await (await fetch(`${base}/api/auth/session`,{headers:{Cookie:cookie}})).json()).admin.username,'class-rep');
    assert.deepEqual(JSON.parse(fs.readFileSync(options.legacyPath,'utf8')),legacy);
  });
  await t.test('admin deletion works, logout and expired sessions revoke access',async()=>{
    for(const [route,item] of [['announcements',announcement],['events',event],['assignments',assignment]]) {
      assert.equal((await send(`${route}/${item.id}`,{},{method:'DELETE'})).status,204);
      assert.ok(!(await get(route)).some(x=>x.id===item.id));
    }
    assert.equal((await send('auth/logout',{})).status,204);
    assert.equal((await send('announcements',{title:'No session',body:'Denied'})).status,401);
    const login=await send('auth/login',{username:'class-rep',password:'testing-password-123'});cookie=login.headers.get('set-cookie').split(';')[0];
    active.store.db.prepare('UPDATE sessions SET expiresAt=0').run();
    assert.equal((await send('events',{title:'Expired',date:'2026-10-02'})).status,401);
  });
});

test('failed legacy import rolls back rather than importing half the data',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'campus-migration-'));
  const file=path.join(temp,'hub.sqlite'),legacyFile=path.join(temp,'db.json');
  try {
    fs.writeFileSync(legacyFile,JSON.stringify({events:[{id:'duplicate',title:'One',date:'2026-10-02',type:'test'},{id:'duplicate',title:'Two',date:'2026-10-02',type:'test'}]}));
    assert.throws(()=>openDatabase(file,legacyFile));
    fs.writeFileSync(legacyFile,JSON.stringify({events:[{id:'fixed',title:'Valid',date:'2026-10-02',type:'test'}]}));
    const store=openDatabase(file,legacyFile);assert.equal(store.list('events').length,1);assert.equal(store.list('events')[0].id,'fixed');store.close();
  } finally {fs.rmSync(temp,{recursive:true,force:true})}
});
