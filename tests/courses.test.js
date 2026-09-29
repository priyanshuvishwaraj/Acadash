import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {hashPassword} from '../server/auth.js';

test('local origins, course relationships and resource lifecycle',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studenthub-courses-'));
 const {app,store}=createApp({databasePath:path.join(dir,'db.sqlite'),uploadDir:path.join(dir,'uploads'),developmentOrigins:['http://localhost:5173','http://127.0.0.1:5173']});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true})});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 let cookie;
 const send=(route,body,method='POST',origin='http://localhost:5173')=>fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 store.db.prepare('INSERT INTO administrators VALUES(?,?,?)').run('rep','rep',hashPassword('test-password-123'));
 for(const origin of ['https://unrelated.example','http://localhost:5174','null'])assert.equal((await send('/auth/login',{username:'rep',password:'test-password-123'},'POST',origin)).status,403);
 for(const route of ['/resources','/courses'])assert.equal((await send(route,{})).status,401);
 const login=await send('/auth/login',{username:'rep',password:'test-password-123'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 let response=await send('/courses',{code:'cs101',name:'Computer Science'});assert.equal(response.status,201);const course=await response.json();assert.equal(course.code,'CS101');
 assert.equal((await send('/courses',{code:'Cs101',name:'Duplicate'})).status,400);
 response=await send('/resources',{title:'Book',kind:'book',description:'Author, Title, second edition',courseId:course.id});assert.equal(response.status,201);const resource=await response.json();
 assert.equal((await send('/resources',{title:'Bad',description:'x',courseId:'missing'})).status,400);
 assert.equal((await send('/resources',{title:'Bad',url:'javascript:alert(1)'})).status,400);
 assert.equal((await send('/resources',{title:'Empty'})).status,400);
 const form=new FormData();form.append('title','Notes');form.append('kind','notes');form.append('courseId',course.id);form.append('pdf',new Blob(['%PDF-1.4\n%%EOF'],{type:'application/pdf'}),'notes.pdf');
 response=await fetch(base+'/resources',{method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:5173'},body:form});assert.equal(response.status,201);const notes=await response.json();
 assert.equal((await fetch(base.replace('/api','')+notes.pdfUrl)).status,200);
 response=await send('/resources/'+notes.id,{title:'Updated notes',kind:'notes',courseId:course.id},'PUT');assert.equal(response.status,200);assert.equal((await response.json()).pdfUrl,notes.pdfUrl);
 const assignment=new FormData();assignment.append('title','Coursework');assignment.append('dueDate','2026-10-10');assignment.append('courseId',course.id);assignment.append('pdf',new Blob(['%PDF-1.4\n%%EOF'],{type:'application/pdf'}),'work.pdf');
 response=await fetch(base+'/assignments',{method:'POST',headers:{Cookie:cookie},body:assignment});assert.equal(response.status,201);assert.equal((await response.json()).courseId,course.id);
 for(const type of ['test','exam']){response=await send('/events',{title:type,date:'2026-10-10',type,courseId:course.id});assert.equal(response.status,201);assert.equal((await response.json()).courseId,course.id);}
 for(const type of ['holiday','fest','custom']){
  response=await send('/events',{title:type,date:'2026-10-11',type,courseId:course.id});assert.equal(response.status,201);const event=await response.json();assert.equal(event.courseId,null);
 }
 response=await send('/events',{title:'Exam changing to holiday',date:'2026-10-12',type:'exam',courseId:course.id});const changed=await response.json();
 response=await send('/events/'+changed.id,{...changed,type:'holiday'},'PUT');assert.equal(response.status,200);assert.equal((await response.json()).courseId,null);
 assert.equal((await send('/courses/'+course.id,{},'DELETE')).status,409);
 response=await send('/courses/'+course.id,{code:'CS102',name:'Revised course'},'PUT');assert.equal(response.status,200);
 const hub=await (await fetch(base+'/hub')).json();assert.equal(hub.courses[0].code,'CS102');assert.equal(hub.resources.length,2);assert.equal(hub.resources[0].courseId,course.id);
 assert.equal((await send('/resources/'+resource.id,{},'DELETE')).status,204);
 assert.equal((await send('/auth/logout',{})).status,204);
 assert.equal((await send('/resources/'+notes.id,{},'DELETE')).status,401);
});
