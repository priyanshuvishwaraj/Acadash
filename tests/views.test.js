import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

const source=fs.readFileSync(new URL('../client/src/App.jsx',import.meta.url),'utf8');
const transformed=await transformWithOxc(source,'App.jsx');
const code=transformed.code.replace('./cloud.js',new URL('../client/src/cloud.js',import.meta.url).href).replace('./discovery.js',new URL('../client/src/discovery.js',import.meta.url).href).replace("./timetable.js",new URL("../client/src/timetable.js",import.meta.url).href).replace(/from ["'](react(?:\/[^"']+)?)['"]/g,(_match,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
const views=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const render=(Component,props,admin=false)=>renderToStaticMarkup(React.createElement(views.Access.Provider,{value:admin},React.createElement(Component,props)));
const announcement={id:'notice',title:'Exam room changed',body:'Now in B-204',createdAt:'2026-09-25T00:00:00Z'};
const assignment={id:'work',title:'Calculus',subject:'Maths',dueDate:'2026-10-02',description:'Chapter 1',pdfUrl:'/uploads/calculus.pdf',originalFileName:'calculus.pdf'};
const event={id:'exam',title:'Mathematics exam',date:'2026-10-02',type:'exam',startTime:'09:30',endTime:'11:00',location:'Main hall'};

test('inactive assignments retain reading access but hide due text and disable submission links',()=>{
 for(const item of [{...assignment,closed:1,dueDate:'2099-10-02'},{...assignment,dueDate:'2000-01-01'}]){
  const html=render(views.AssignmentsPage,{items:[item]});
  assert.match(html,/assignment-card is-inactive/);assert.match(html,/Open PDF/);assert.doesNotMatch(html,/Due ·|Due today|Due tomorrow/);
  const detail=render(views.ItemDetail,{page:'assignments',item:{...item,submissionUrl:'https://example.com/submit'}});
  assert.match(detail,/disabled=""[^>]*>Submissions closed/);assert.doesNotMatch(detail,/href="https:\/\/example.com\/submit"/);assert.match(detail,/Open PDF/);
 }
 const active=render(views.AssignmentsPage,{items:[{...assignment,dueDate:'2099-10-02'}]});
 assert.doesNotMatch(active,/is-inactive/);assert.match(active,/Due ·/);
});

test('closed assignments are omitted from the home upcoming list',()=>{
 const html=render(views.Home,{hub:{schedule:[],announcements:[],events:[],assignments:[{...assignment,closed:1,dueDate:'2099-10-02'}]},go:()=>{}});
 assert.doesNotMatch(html,/Calculus/);assert.match(html,/You’re up to date/);
});

test('student views show shared content and never expose publishing controls',()=>{
  for(const [Page,items,expected] of [[views.AnnouncementsPage,[announcement],'Exam room changed'],[views.AssignmentsPage,[assignment],'Calculus'],[views.EventsPage,[event],'Mathematics exam']]) {
    const html=render(Page,{items,onAdd:()=>{},onDelete:()=>{}});
    if(Page!==views.EventsPage) assert.ok(html.includes(expected));
    assert.doesNotMatch(html,/>Add (update|assignment|event)</);
    assert.doesNotMatch(html,/>Edit<|>Delete</);
  }
  const html=render(views.TimetablePage,{items:[{id:'class',day:1,start:'09:00',end:'10:00',subject:'Maths',room:'B-204'}],revision:0});
  assert.match(html,/Maths/);assert.match(html,/B-204/);assert.doesNotMatch(html,/schedule-cell-button/);
});
test('administrator views expose editing controls',()=>{
  const html=render(views.AnnouncementsPage,{items:[announcement],onAdd:()=>{},onDelete:()=>{}},true);
  assert.match(html,/>Add update</);assert.match(html,/>Edit</);assert.match(html,/>Delete</);
  const timetable=render(views.TimetablePage,{items:[],revision:0},true);assert.match(timetable,/Add class, Monday 08:00/);
  const assignments=render(views.AssignmentsPage,{items:[assignment]},true);assert.match(assignments,/>Edit</);
});
test('event timing and venue render with explicit unknown-time fallback',()=>{
  let html=render(views.EventDetails,{item:event});assert.match(html,/9:30 am/);assert.match(html,/11:00 am/);assert.match(html,/Main hall/);
  html=render(views.EventDetails,{item:{...event,startTime:'',endTime:''}});assert.match(html,/Time to be announced/);
});
test('calendar dates remain aligned across year boundaries and leap years',()=>{
  const january=views.buildCalendar(2027,0);assert.equal(january.length,42);assert.equal(january[0].date,'2026-12-28');assert.equal(january[4].date,'2027-01-01');assert.equal(january[4].day,1);
  assert.ok(views.buildCalendar(2028,1).some(c=>c.date==='2028-02-29' && c.current));
});
test('navigation includes Resources alongside the existing pages',()=>{
  const oldWindow=globalThis.window;globalThis.window={location:{hash:''}};
  try {
    const html=render(views.App,{});
    const order=['#home','#announcements','#assignments','#resources','#events','#timetable'].map(href=>html.indexOf(`href="${href}"`));
    assert.ok(order.every(index=>index>=0));assert.deepEqual(order,[...order].sort((a,b)=>a-b));assert.match(html,/Admin sign in/);
  } finally {globalThis.window=oldWindow}
});

test('crowded calendar dates prioritize exams and tests and retain every category marker',()=>{
  const now=new Date();
  const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const items=['custom','holiday','assignment','test','exam'].map(type=>({id:type,type,date,title:`${type} example`}));
  const html=render(views.EventsPage,{items});
  const cell=html.match(/<button[^>]*class="calendar-cell [^"]*has-exam[\s\S]*?<\/button>/)?.[0];
  assert.ok(cell,'Exam date receives a full-cell highlight');
  assert.ok(cell.indexOf('event-pill exam')<cell.indexOf('event-pill test'));
  assert.match(cell,/Exam · exam example/);
  assert.match(cell,/Test · test example/);
  assert.match(cell,/\+2 more/);
  for(const {type} of items) assert.ok(cell.includes(`dot ${type}`));
  const testOnly=render(views.EventsPage,{items:items.filter(item=>item.type==='test')});
  assert.match(testOnly,/calendar-cell [^"]*has-test/);
});

test('timetable uses college hours, duration spans and saved class colors',()=>{
  const html=render(views.TimetablePage,{items:[{id:'long',day:1,start:'16:00',end:'18:00',subject:'Physics',room:'Lab',color:'blue'}],revision:2});
  assert.match(html,/8 am–9 am/);assert.match(html,/5 pm–6 pm/);assert.doesNotMatch(html,/6 pm–7 pm/);
  assert.match(html,/rowSpan="2"/i);assert.match(html,/#e7f1fc/);assert.doesNotMatch(html,/schedule-image/);
});
test('assignments are grouped by course with a fallback for unassigned work',()=>{
  const html=render(views.AssignmentsPage,{items:[assignment,{...assignment,id:'other',subject:'Physics'},{...assignment,id:'none',subject:''}]});
  assert.match(html,/<h3>Maths<\/h3>/);assert.match(html,/<h3>Physics<\/h3>/);assert.match(html,/<h3>General<\/h3>/);
});

test('resources expose course filtering and restrict publishing to administrators',()=>{
 const props={items:[{id:'r',title:'Reading list',kind:'book',courseId:'cs',description:'Chapter 2',url:'https://example.com/book'}]};
 const courses=[{id:'cs',code:'CS101',name:'Computer Science'}];
 const renderResources=admin=>renderToStaticMarkup(React.createElement(views.Catalog.Provider,{value:courses},React.createElement(views.Access.Provider,{value:admin},React.createElement(views.ResourcesPage,props))));
 const html=renderResources(false);assert.match(html,/Filter by course/);assert.match(html,/CS101 · Computer Science/);assert.match(html,/Reading list/);assert.doesNotMatch(html,/>Add resource</);
 assert.match(renderResources(true),/>Add resource</);
});

test('calendar weekends gray only when empty and every event type overrides off styling',()=>{
 const now=new Date(),cells=views.buildCalendar(now.getFullYear(),now.getMonth());
 const saturday=cells.find(c=>new Date(`${c.date}T12:00:00`).getDay()===6).date;
 const sunday=cells.find(c=>new Date(`${c.date}T12:00:00`).getDay()===0).date;
 const weekday=cells.find(c=>new Date(`${c.date}T12:00:00`).getDay()===1).date;
 assert.equal(views.calendarDayState(saturday,[]).off,true);assert.equal(views.calendarDayState(sunday,[]).off,true);assert.equal(views.calendarDayState(weekday,[]).off,false);
 for(const type of ['exam','test','holiday','fest','assignment','custom']){
  const item={id:type,type,date:saturday,title:`${type} on Saturday`};
  const state=views.calendarDayState(saturday,[item]);assert.equal(state.off,false);assert.equal(state.primary,type);
  const html=render(views.EventsPage,{items:[item]});
  const cell=html.match(new RegExp(`<button[^>]*class="calendar-cell [^"]*has-${type}[\\s\\S]*?<\\/button>`))?.[0];
  assert.ok(cell);assert.doesNotMatch(cell,/is-off/);assert.match(cell,/--day-tint/);
 }
 const html=render(views.EventsPage,{items:[]});assert.match(html,/Weekend off/);assert.match(html,/class="calendar-cell [^"]*is-off/);
});
test('event form offers courses only for exams and tests',()=>{
 for(const type of ['exam','test','holiday','fest','custom']){
  const html=render(views.EventModal,{initial:{title:'Example',date:'2026-09-26',type,startTime:'',endTime:'',location:'',description:'',courseId:'old-course'},onClose:()=>{},onSave:()=>{}});
  if(['exam','test'].includes(type))assert.match(html,/<label>Course<select/);else assert.doesNotMatch(html,/<label>Course<select/);
 }
});

test('update feed stays bounded and exposes category and importance filters',()=>{
 const items=Array.from({length:30},(_,i)=>({...announcement,id:`notice-${i}`,title:`Notice ${i}`,category:'academic',important:i===0,source:'Academic office'}));
 const html=render(views.AnnouncementsPage,{items});
 assert.match(html,/Important only/);assert.match(html,/Academic office/);assert.match(html,/important-update/);assert.match(html,/Show more updates/);
 assert.equal((html.match(/class="announcement /g)||[]).length,12);
});
test('assignment details expose submission and calendar integration without editing',()=>{
 const html=render(views.ItemDetail,{page:'assignments',item:{...assignment,submissionUrl:'https://example.com/submit'},onClose:()=>{},onNavigate:()=>{}});
 assert.match(html,/Submission page/);assert.match(html,/See deadline in calendar/);assert.match(html,/Chapter 1/);assert.doesNotMatch(html,/>Delete</);
});
test('mobile schedule retains day choices and class details',()=>{
 const html=render(views.ScheduleOverview,{items:[{id:'s',day:1,start:'09:00',end:'10:00',subject:'Physics',room:'Lab'}],revision:0});
 assert.match(html,/Schedule day/);assert.match(html,/Next today/);assert.equal((html.match(/aria-pressed=/g)||[]).length,7);
});

test('assignment details carry course IDs rather than display labels',()=>{
 const html=render(views.AssignmentsPage,{items:[{...assignment,courseId:'course-id'}],initialCourse:'course-id'});
 assert.match(html,/&amp;course=course-id/);
 assert.doesNotMatch(html,/&amp;course=Maths/);
});

test('Home shows the latest campus news with metadata and resource shortcuts',async()=>{
 const {campusClock}=await import('../client/src/discovery.js');
 const {date,day}=campusClock();
 const midnight=new Date(`${date}T00:00:00+05:30`);
 const current={...announcement,id:'today',title:'Today campus notice',createdAt:midnight.toISOString(),category:'exam',important:1,source:'Exam office',courseId:'math',eventId:'exam'};
 const old={...current,id:'old',title:'Yesterday campus notice',createdAt:new Date(midnight.getTime()-1).toISOString()};
 const hub={schedule:[{id:'class',day,start:'09:00',end:'10:00',subject:'Maths',color:'blue'}],assignments:[{...assignment,dueDate:date}],events:[{...event,date}],announcements:[old,current]};
 const html=render(views.Home,{hub,go:()=>{}});
 assert.match(html,/Today campus notice/);assert.match(html,/Yesterday campus notice/);
 assert.match(html,/important-update/);assert.match(html,/Exam office/);assert.match(html,/Related event/);assert.match(html,/Course resources|#resources\?course=math/);
 assert.match(html,/home-class-row/);assert.match(html,/Quick resources/);
 const empty=render(views.Home,{hub:{...hub,announcements:[]},go:()=>{}});assert.match(empty,/New announcements will appear here/);
});
