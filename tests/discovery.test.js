import test from 'node:test';
import assert from 'node:assert/strict';
import {campusClock,scheduleNow,searchHub,validDate} from '../client/src/discovery.js';
const now=new Date('2026-09-28T03:45:00Z'); // Monday 9:15 IST
const hub={courses:[{id:'p',code:'PHY101',name:'Physics'}],announcements:[{id:'u',title:'Mid semester rooms',body:'Exam moved to Hall B',category:'exam',createdAt:'2026-09-28T00:00:00Z'}],resources:[{id:'r',title:'Unit 3',kind:'notes',resourceType:'lab',courseId:'p',description:'Optics lab manual',originalFileName:'physics-notes.pdf',createdAt:'2026-09-27T00:00:00Z'}],assignments:[{id:'a',title:'Optics assignment',courseId:'p',dueDate:'2026-09-29'}],events:[{id:'e',title:'Campus holiday',type:'holiday',date:'2026-09-29'}],schedule:[{id:'s',day:1,start:'09:00',end:'10:00',subject:'Optics',courseId:'p',room:'Lab A'},{id:'n',day:1,start:'11:00',end:'12:00',subject:'Mechanics'}]};
test('search joins course and file metadata across all five content types',()=>{
 for(const [query,id] of [['physics notes','r'],['lab manual','r'],['PHY101 assignment','a'],['mid sem','u'],['holiday','e'],['Lab A','s']])assert.ok(searchHub(hub,query,now).some(r=>r.item.id===id),query);
 assert.equal(new Set(searchHub(hub,'',now).map(r=>r.type)).size,5);
 assert.deepEqual(searchHub(hub,'nothing matches',now),[]);
});
test('relative dates use campus IST even across UTC midnight',()=>{
 assert.equal(campusClock(new Date('2026-09-28T19:00:00Z')).date,'2026-09-29');
 assert.deepEqual(searchHub(hub,'tomorrow',now).map(r=>r.item.id).sort(),['a','e']);
 assert.deepEqual(searchHub(hub,'holiday tomorrow',now).map(r=>r.item.id),['e']);
});
test('current and next class use exclusive end boundaries and ordered starts',()=>{
 assert.equal(scheduleNow(hub.schedule,now).current.id,'s');assert.equal(scheduleNow(hub.schedule,now).next.id,'n');
 const between=scheduleNow(hub.schedule,new Date('2026-09-28T04:30:00Z'));assert.equal(between.current,undefined);assert.equal(between.next.id,'n');
 assert.equal(scheduleNow(hub.schedule,new Date('2026-09-28T08:00:00Z')).next,undefined);
});

test('calendar deep links reject malformed and impossible dates',()=>{
 for(const value of ['2026-99-99','2026-02-30','2026-2-1','bad',null])assert.equal(validDate(value),false);
 assert.equal(validDate('2028-02-29'),true);
});
