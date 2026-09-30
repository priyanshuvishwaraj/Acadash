export const updateCategories={general:'Campus',academic:'Academic',exam:'Exams',assignment:'Assignments',schedule:'Schedule changes',event:'Events',club:'Clubs',administrative:'Administration'};
export const resourceTypes={notes:'Notes',lecture:'Lecture material',paper:'Previous-year paper',syllabus:'Syllabus',lab:'Lab manual',book:'Book reference',reference:'Reference',assignment:'Assignment material',link:'Useful link',other:'Other'};
export function campusClock(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`;
  return {date,time:`${parts.hour}:${parts.minute}`,day:(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7+1};
}
// Date-only deadlines expire after the entire due date in campus time (IST).
export function assignmentState(item,now=new Date()) {
  if(item.closed===true || item.closed===1 || item.closed==='1')return 'closed';
  return item.dueDate<campusClock(now).date?'expired':'active';
}
export function validDate(value) {return /^\d{4}-\d{2}-\d{2}$/.test(value||'') && !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}
export function offsetDate(date,days) {const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function scheduleNow(items,now=new Date()) {
  const clock=campusClock(now),today=items.filter(c=>c.day===clock.day).sort((a,b)=>a.start.localeCompare(b.start));
  return {...clock,today,current:today.find(c=>c.start<=clock.time && c.end>clock.time),next:today.find(c=>c.start>clock.time)};
}
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function searchHub(hub,query,now=new Date()) {
  const clock=campusClock(now),course=id=>{const c=(hub.courses||[]).find(c=>c.id===id);return c?`${c.code} ${c.name}`:''};
  const rows=[];
  const add=(type,page,item,title,detail,date,extra='')=>rows.push({key:`${page}:${item.id}`,type,page,item,title,detail,date,text:normalize(`${title} ${detail} ${extra}`)});
  (hub.announcements||[]).forEach(x=>add('Updates','announcements',x,x.title,`${updateCategories[x.category]||'Campus'} · ${course(x.courseId)}`,x.createdAt?campusClock(new Date(x.createdAt)).date:undefined,`${x.body} ${x.source} ${x.important?'important urgent':''}`));
  (hub.resources||[]).forEach(x=>add('Resources','resources',x,x.title,`${resourceTypes[x.resourceType||x.kind]||'Resource'} · ${course(x.courseId)}`,x.createdAt?campusClock(new Date(x.createdAt)).date:undefined,`${x.description} ${x.originalFileName} ${x.pdfUrl?'pdf':''}`));
  (hub.assignments||[]).forEach(x=>add('Assignments','assignments',x,x.title,`Assignment · ${course(x.courseId)||x.subject} · ${assignmentState(x,now)==='active'?'Due '+x.dueDate:assignmentState(x,now)==='closed'?'Closed':'Ended'}`,x.dueDate,`${x.description} ${x.originalFileName}`));
  (hub.events||[]).forEach(x=>add('Calendar','events',x,x.title,`${x.type} · ${x.date} · ${course(x.courseId)}`,x.date,`${x.description} ${x.location} ${x.startTime}`));
  (hub.schedule||[]).forEach(x=>add('Classes','timetable',x,x.subject,`${course(x.courseId)} · ${x.start}–${x.end} · ${x.room}`,offsetDate(clock.date,(x.day-clock.day+7)%7),`${x.professor||''} ${x.classType||''} ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][x.day-1]} class schedule`));
  const tokens=normalize(query).split(' ').filter(Boolean),dateToken=tokens.find(t=>t==='today'||t==='tomorrow');
  const target=dateToken?offsetDate(clock.date,dateToken==='tomorrow'?1:0):null;
  const words=tokens.filter(t=>t!=='today'&&t!=='tomorrow');
  return rows.filter(r=>(!target||r.date===target)&&words.every(w=>r.text.includes(w))).map(r=>({...r,score:words.reduce((n,w)=>n+(normalize(r.title).includes(w)?3:1),0)})).sort((a,b)=>b.score-a.score||(b.date||'').localeCompare(a.date||'')||a.title.localeCompare(b.title)).slice(0,60);
}
