import { cloudEnabled, cloudRequest } from './cloud.js';
import { campusClock, scheduleNow, offsetDate, validDate, searchHub, updateCategories, resourceTypes } from './discovery.js';
import { classColors, colorFor, clockLabel, timeBoundaries, classTitle, renderTimetable } from './timetable.js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const API='/api';
const Access=createContext(false);
const FiltersContext=createContext(false);
const Catalog=createContext([]);
const HubContext=createContext({});
function courseLabel(courses,id,fallback='General') {const c=courses.find(c=>c.id===id);return c?`${c.code} · ${c.name}`:fallback;}
function CourseSelect({value,onChange,legacy}) {const courses=useContext(Catalog);return <label>Course<select value={value || ''} onChange={e=>onChange(e.target.value)}><option value="">{legacy?`Unassigned · ${legacy}`:'General / no course'}</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>;}
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const pages=[{id:'home',label:'Home',icon:'⌂'},{id:'announcements',label:'News',icon:'◉'},{id:'assignments',label:'Assignments',icon:'✓'},{id:'resources',label:'Resources',icon:'▤'},{id:'events',label:'Calendar',icon:'◫'},{id:'timetable',label:'Timetable',icon:'▦'}];
const typeMeta={assignment:{label:'Assignment',icon:'▣'},test:{label:'Test',icon:'◇'},exam:{label:'Exam',icon:'✦'},fest:{label:'Fest',icon:'◆'},holiday:{label:'Holiday',icon:'●'},custom:{label:'Other',icon:'＋'}};
const calendarColors={exam:{accent:'#c43838',tint:'#fdeaea'},test:{accent:'#7950b2',tint:'#f2ebfc'},holiday:{accent:'#32935d',tint:'#eaf6ee'},fest:{accent:'#bc861c',tint:'#fff4d9'},assignment:{accent:'#3888bd',tint:'#edf5fc'},custom:{accent:'#36848b',tint:'#ebf6f6'}};
const eventPriority=['exam','test','holiday','fest','assignment','custom'];
function calendarDayState(date,items) {
  const types=eventPriority.filter(type=>items.some(item=>item.type===type));
  const weekend=[0,6].includes(new Date(`${date}T12:00:00`).getDay());
  return {types,primary:types[0],off:weekend && items.length===0};
}
const emptyHub={courses:[],resources:[],schedule:[],assignments:[],events:[],announcements:[],scheduleRevision:0};
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return campusClock().date; }
function fmtDate(value,opts={dateStyle:'medium'}) { return new Intl.DateTimeFormat('en-IN',opts).format(new Date(`${value}T00:00:00`)); }
function fmtTime(value) { if(!value) return ''; const [h,m]=value.split(':').map(Number); return `${h%12 || 12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`; }
function eventTime(item) { return item.startTime ? `${fmtTime(item.startTime)}${item.endTime ? ` – ${fmtTime(item.endTime)}` : ''}` : 'Time to be announced'; }
async function request(url,options) {
  if(cloudEnabled)return cloudRequest(url,options);
  const response=await fetch(url,{credentials:'same-origin',...options});
  const data=response.status===204 ? null : await response.json();
  if(!response.ok) {
    if(response.status===401 && !url.endsWith('/login')) window.dispatchEvent(new Event('hub-session-expired'));
    throw new Error(data?.error || 'Request failed. Please try again.');
  }
  return data;
}
const jsonOptions=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function currentPage() { const id=window.location.hash.slice(1).split('?')[0]; return pages.some(p=>p.id===id) ? id : 'home'; }

function App() {
  const [page,setPage]=useState(currentPage);
  const [filtersExpanded,setFiltersExpanded]=useState(false);
  useEffect(()=>setFiltersExpanded(false),[page]);
  const [route,setRoute]=useState(()=>window.location.hash);
  const [searchOpen,setSearchOpen]=useState(false);
  const [hub,setHub]=useState(emptyHub);
  const [session,setSession]=useState({admin:null,configured:false});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [cleanupPending,setCleanupPending]=useState(false);
  const [login,setLogin]=useState(false);
  const [manageCourses,setManageCourses]=useState(false);
  const [updated,setUpdated]=useState(null);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const run=++generation.current;
    try {
      const [data,auth]=await Promise.all([request(`${API}/hub`),request(`${API}/auth/session`)]);
      if(run!==generation.current) return;
      setHub(data);setSession(auth);setError('');setUpdated(new Date());
    } catch(err) { if(run===generation.current)setError(err.message); }
    finally { if(run===generation.current)setLoading(false); }
  },[]);
  useEffect(()=>{
    refresh();
    const visibleRefresh=()=>{if(document.visibilityState==='visible')refresh()};
    const timer=setInterval(visibleRefresh,cloudEnabled?300000:60000);
    const cleanup=()=>setCleanupPending(true);
    window.addEventListener('hub-cleanup-pending',cleanup);
    const navigate=()=>{setPage(currentPage());setRoute(window.location.hash)};
    const expired=()=>setSession(s=>({...s,admin:null}));
    window.addEventListener('hashchange',navigate);
    window.addEventListener('focus',visibleRefresh);
    window.addEventListener('hub-session-expired',expired);
    return ()=>{clearInterval(timer);generation.current++;window.removeEventListener('hashchange',navigate);window.removeEventListener('focus',visibleRefresh);window.removeEventListener('hub-cleanup-pending',cleanup);window.removeEventListener('hub-session-expired',expired)};
  },[refresh]);
  useEffect(()=>{const shortcut=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(v=>!v)}};window.addEventListener('keydown',shortcut);return ()=>window.removeEventListener('keydown',shortcut)},[]);
  const go=id=>{window.location.hash=id;setPage(id.split('?')[0]);setRoute('#'+id)};
  const routeParams=new URLSearchParams(route.split('?')[1]||'');
  const detailId=routeParams.get('item'),courseFilter=routeParams.get('course')??'all';
  const detailItem=hub[page==='timetable'?'schedule':page]?.find?.(x=>x.id===detailId);
  const closeDetail=()=>{const params=new URLSearchParams(routeParams);params.delete('item');go(page+(params.size?'?'+params.toString():''))};
  const openResult=result=>{setSearchOpen(false);go(`${result.page}?item=${encodeURIComponent(result.item.id)}`)};
  const mutate=async(url,options)=>{const result=await request(url,options);await refresh();return result};
  async function remove(collection,id) {
    if(!window.confirm(cloudEnabled?'Remove this item? Any attached PDF and preview will also be permanently deleted.':'Remove this item from the shared hub?')) return;
    try { await mutate(`${API}/${collection}/${id}`,{method:'DELETE'}); } catch(err) {setError(err.message)}
  }
  async function signOut() {try{await request(`${API}/auth/logout`,{method:'POST'});setSession(s=>({...s,admin:null}))}catch(err){setError(err.message)}}
  const calendarItems=useMemo(()=>[
    ...hub.assignments.map(a=>({...a,id:`assignment:${a.id}`,date:a.dueDate,type:'assignment'})),...hub.events
  ].sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||'')),[hub]);
  const canEdit=!!session.admin;
  return <Access.Provider value={canEdit}><Catalog.Provider value={hub.courses || []}><HubContext.Provider value={hub}><FiltersContext.Provider value={filtersExpanded}><div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content').focus()}}>Skip to content</a>
    <aside className="sidebar"><div className="brand"><div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5.5C9 3.5 5.5 3.5 2.5 4.5v14c3-1 6.5-1 9.5 1 3-2 6.5-2 9.5-1v-14c-3-1-6.5-1-9.5 1Z"/><path d="M12 5.5v14M6 8h2.5M6 11h2.5M15.5 8H18M15.5 11H18"/></svg></div><div><strong>StudentHub</strong></div></div>
      <nav aria-label="Main navigation">{pages.map(p=><a key={p.id} href={`#${p.id}`} className={`nav-item ${page===p.id?'active':''}`} aria-current={page===p.id?'page':undefined} title={p.label}><span className="nav-icon" aria-hidden="true">{p.icon}</span><span className="nav-label">{p.label}</span></a>)}</nav>
      <div className="sidebar-foot account-panel" aria-label="Account">{canEdit ? <><button className="secondary" onClick={()=>setManageCourses(true)}>Courses</button><span className="admin-label">Signed in as {session.admin.username}</span><button className="secondary" onClick={signOut}>Sign out</button></> : <button className="secondary" onClick={()=>setLogin(true)}>Admin sign in</button>}</div>
    </aside>
    <main className="main" id="main-content" tabIndex={-1}>
      <header className="topbar"><div className="page-heading"><h1>{pages.find(p=>p.id===page)?.label}</h1><time className="today-pill" dateTime={todayISO()}>{fmtDate(todayISO(),{weekday:'short',day:'numeric',month:'long'})}</time><button className="search-trigger secondary" onClick={()=>setSearchOpen(true)} aria-label="Search the hub">⌕ <span>Search the hub</span></button></div><div className="mobile-account" aria-label="Account">{canEdit ? <><button className="secondary" onClick={()=>setManageCourses(true)}>Courses</button><span className="admin-label">Signed in as {session.admin.username}</span><button className="secondary" onClick={signOut}>Sign out</button></> : <button className="secondary" onClick={()=>setLogin(true)}>Admin sign in</button>}</div>{['announcements','assignments','resources','events'].includes(page) && <button type="button" className="secondary filter-toggle" aria-label="Filters" aria-expanded={filtersExpanded} onClick={()=>setFiltersExpanded(value=>!value)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface-container)"/><circle cx="15" cy="17" r="3" fill="var(--surface-container)"/></svg></button>}</header>
      {cleanupPending && canEdit && <div className="alert" role="status">The change was saved, but file cleanup is pending. <button className="text-btn" onClick={async()=>{try{const result=await request('/api/cleanup',{method:'POST'});setCleanupPending(Boolean(result?.failed))}catch(err){setError(err.message)}}}>Retry cleanup</button></div>}
      {error && <div className="alert error" role="alert">{error} {updated && 'Showing the last loaded information.'}</div>}
      {!loading && detailId && !detailItem && !error && <div className="loading" role="status">This item is no longer available. <button className="text-btn" onClick={closeDetail}>Back to {pages.find(p=>p.id===page)?.label}</button></div>}
      {loading ? <div className="loading" role="status">Loading campus updates…</div> : <>
        {page==='home' && <Home hub={hub} go={go} />}
        {page==='announcements' && <AnnouncementsPage items={hub.announcements} onAdd={(payload,id)=>mutate(`${API}/announcements${id?`/${id}`:''}`,jsonOptions(id?'PUT':'POST',payload))} onDelete={id=>remove('announcements',id)} />}
        {page==='assignments' && <AssignmentsPage key={courseFilter} initialCourse={courseFilter} items={hub.assignments} onAdd={(body,id)=>mutate(`${API}/assignments${id?`/${id}`:''}`,{method:id?'PUT':'POST',body})} onDelete={id=>remove('assignments',id)} />}
        {page==='resources' && <ResourcesPage key={courseFilter} initialCourse={courseFilter} items={hub.resources || []} onSave={(body,id)=>mutate(`${API}/resources${id?`/${id}`:''}`,{method:id?'PUT':'POST',body})} onDelete={id=>remove('resources',id)}/>}
        {page==='events' && <EventsPage focusDate={detailItem?.date || routeParams.get('date')} items={calendarItems} onAdd={(payload,id)=>mutate(`${API}/events${id?`/${id}`:''}`,jsonOptions(id?'PUT':'POST',payload))} onDelete={id=>remove('events',id)} />}
        {page==='timetable' && <TimetablePage items={hub.schedule} revision={hub.scheduleRevision} onSave={(entries,revision)=>mutate(`${API}/schedule`,jsonOptions('PUT',{entries,revision}))} />}
      </>}
    </main>
    {searchOpen && <SearchPalette hub={hub} onClose={()=>setSearchOpen(false)} onSelect={openResult}/>}
    {detailItem && !searchOpen && <ItemDetail key={`${page}:${detailId}`} page={page} item={detailItem} onClose={closeDetail} onNavigate={go}/>}
    {manageCourses && canEdit && <CourseManager onClose={()=>setManageCourses(false)} onSave={(payload,id)=>mutate(`${API}/courses${id?`/${id}`:''}`,jsonOptions(id?'PUT':'POST',payload))}/>}
    {login && <LoginModal configured={session.configured} onClose={()=>setLogin(false)} onLogin={async payload=>{const result=await request(`${API}/auth/login`,jsonOptions('POST',payload));setSession({admin:result.admin,configured:true});setLogin(false)}} />}
  </div></FiltersContext.Provider></HubContext.Provider></Catalog.Provider></Access.Provider>;
}
function FilterPanel({children,compact=false}) {
  const expanded=useContext(FiltersContext);
  return <div className={`filter-panel ${compact?'filter-panel-compact':''}`}><div className={`browse-toolbar filter-controls ${expanded?'is-expanded':''}`}>{children}</div></div>;
}
function Empty({text}) { return <div className="empty">{text}</div>; }
function EventDetails({item}) {const courses=useContext(Catalog);return <>{item.courseId && <small>{courseLabel(courses,item.courseId)}</small>}<p>{typeMeta[item.type]?.label} · {item.type==='assignment'?'Due this day':eventTime(item)}</p>{item.location && <small>Venue · {item.location}</small>}{item.description && <small>{item.description}</small>}</>}
function Home({hub,go}) {
  const courses=useContext(Catalog),today=todayISO();
  const day=campusClock().day;
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return ()=>clearInterval(timer)},[]);
  const live=scheduleNow(hub.schedule,now);
  const classes=hub.schedule.filter(c=>c.day===day).sort((a,b)=>a.start.localeCompare(b.start));
  const upcoming=[...hub.assignments.map(a=>({...a,date:a.dueDate,type:'assignment'})),...hub.events].filter(e=>e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||'')).slice(0,5);
  const news=hub.announcements.filter(item=>item.createdAt && campusClock(new Date(item.createdAt)).date===today).sort((a,b)=>Number(b.important||0)-Number(a.important||0)||b.createdAt.localeCompare(a.createdAt)).slice(0,3);
  return <section className="home-dashboard">
    <section className="card home-news"><div className="section-head"><h3>Today’s updates</h3><button className="text-btn" onClick={()=>go('announcements')}>All news ↗</button></div>{news.length ? news.map(item=><Announcement key={item.id} item={item}/>) : <p className="helper">No announcements posted today. Browse News for earlier updates.</p>}</section>

    <div className="home-columns"><section className="card home-agenda"><div className="section-head"><h3>Today’s classes</h3><button className="text-btn" onClick={()=>go('timetable')}>Full timetable ↗</button></div>{classes.length ? <div className="agenda-list">{classes.map(c=><div className={`agenda-row colored-class ${live.current?.id===c.id?'current-class':live.next?.id===c.id?'next-class':''}`} key={c.id} style={{'--class-ink':colorFor(c).ink,'--class-fill':colorFor(c).fill}}><div><a className="class-detail-link" href={`#timetable?item=${encodeURIComponent(c.id)}`}><strong>{classTitle(c)}{live.current?.id===c.id?' · Now':live.next?.id===c.id?' · Next':''}</strong></a><small className="class-meta">{fmtTime(c.start)}–{fmtTime(c.end)} · {c.room || 'Room TBA'}</small></div></div>)}</div> : <div className="home-empty"><span>All clear today</span><p>No classes are scheduled today. Check the calendar for other campus dates.</p></div>}</section>
    <section className="card"><div className="section-head"><h3>Up next</h3><button className="text-btn" onClick={()=>go('events')}>Calendar ↗</button></div>{upcoming.length ? <div className="home-deadlines">{upcoming.map(e=><a className={`deadline-row colored-event ${e.type}`} style={{'--day-accent':calendarColors[e.type]?.accent,'--day-tint':calendarColors[e.type]?.tint}} key={`${e.type}:${e.id}`} href={e.type==='assignment'?`#assignments?item=${encodeURIComponent(e.id)}`:`#events?item=${encodeURIComponent(e.id)}`}><div className="date-chip"><strong>{Number(e.date.slice(-2))}</strong><span>{fmtDate(e.date,{month:'short'})}</span></div><div><strong>{e.title}</strong><span>{e.date===today?'Today · ':''}{typeMeta[e.type]?.label}{e.courseId?' · '+courseLabel(courses,e.courseId):''}</span></div><span aria-hidden="true">↗</span></a>)}</div> : <div className="home-empty"><span>You’re up to date</span><p>No upcoming deadlines or events have been published.</p></div>}</section></div>

  </section>;
}
function CourseLink({id,label='Course resources'}) {return id?<a className="text-btn" href={`#resources?course=${encodeURIComponent(id)}`}>{label} ↗</a>:null}
function Posted({value}) {return value?<time className="posted-at" dateTime={value}>Posted {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value))}</time>:null}
function BrowseCourse({value,onChange}) {const courses=useContext(Catalog);return <label>Course<select value={value} onChange={e=>onChange(e.target.value)}><option value="all">All courses</option><option value="">General / no course</option>{courses.map(c=><option value={c.id} key={c.id}>{c.code} · {c.name}</option>)}</select></label>}
function Announcement({item,onDelete,onEdit}) {
  const courses=useContext(Catalog);
  return <article className={`announcement ${item.important?'important-update':''}`}><div className="announcement-content"><div className="item-meta">{!!item.important && <span className="importance">Important</span>}<span>{updateCategories[item.category]||'Campus'}</span>{item.source && <span>{item.source}</span>}<Posted value={item.createdAt}/></div><h3><a href={`#announcements?item=${encodeURIComponent(item.id)}`}>{item.title}</a></h3><p className="clamp-text">{item.body}</p><div className="related-links">{item.courseId && <CourseLink id={item.courseId} label={courseLabel(courses,item.courseId)}/>} {item.eventId && <a className="text-btn" href={`#events?item=${encodeURIComponent(item.eventId)}`}>Related event ↗</a>}</div></div>{onDelete && <div className="item-actions"><button className="text-btn" onClick={()=>onEdit(item)}>Edit</button><button className="danger-btn" aria-label={`Delete update: ${item.title}`} onClick={()=>onDelete(item.id)}>Delete</button></div>}</article>;
}
function AnnouncementsPage({items,onAdd,onDelete}) {
  const canEdit=useContext(Access),[open,setOpen]=useState(false),[category,setCategory]=useState('all'),[course,setCourse]=useState('all'),[important,setImportant]=useState(false),[limit,setLimit]=useState(12);
  const visible=items.filter(x=>(category==='all'||(x.category||'general')===category)&&(course==='all'||(x.courseId||'')===course)&&(!important||x.important)).sort((a,b)=>Number(b.important||0)-Number(a.important||0)||b.createdAt.localeCompare(a.createdAt));
  return <section className="page-grid"><FilterPanel><label>Category<select value={category} onChange={e=>{setCategory(e.target.value);setLimit(12)}}><option value="all">All updates</option>{Object.entries(updateCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><BrowseCourse value={course} onChange={v=>{setCourse(v);setLimit(12)}}/><label className="check-label"><input type="checkbox" checked={important} onChange={e=>{setImportant(e.target.checked);setLimit(12)}}/>Important only</label>{canEdit && <button className="primary" onClick={()=>setOpen(true)}>Add update</button>}</FilterPanel><div className="card"><div className="section-head"><h3>Latest updates</h3><span className="count-pill">{visible.length} updates</span></div>{visible.length ? visible.slice(0,limit).map(item=><Announcement key={item.id} item={item} onDelete={canEdit?onDelete:undefined} onEdit={setOpen}/>) : <Empty text="No updates match these filters."/>}{visible.length>limit && <button className="secondary load-more" onClick={()=>setLimit(n=>n+12)}>Show more updates</button>}</div>{open && canEdit && <AnnouncementModal initial={typeof open==='object'?open:undefined} onClose={()=>setOpen(false)} onSave={async data=>{await onAdd(data,open?.id);setOpen(false)}}/>}</section>;
}
function PdfPreview({url,title,subject,previewUrl}) {
  if(cloudEnabled || previewUrl)return <a className="pdf-preview" href={url} target="_blank" rel="noreferrer" aria-label={`Open PDF: ${title}`}>
    {previewUrl?<img src={previewUrl} loading="lazy" decoding="async" alt={`First page of ${title}`} onError={e=>{e.currentTarget.style.display='none'}}/>:<span className="pdf-preview-placeholder">Open PDF in Google Drive ↗</span>}
    <span className="pdf-preview-overlay"><strong>{title}</strong><span>{subject}</span></span>
  </a>;
  return <LocalPdfPreview url={url} title={title} subject={subject}/>;
}
function LocalPdfPreview({url,title,subject}) {
  const [preview,setPreview]=useState({url,image:'',failed:false});
  const previewRef=useRef(null),[inView,setInView]=useState(false);
  useEffect(()=>{if(!('IntersectionObserver' in window)){setInView(true);return}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setInView(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(previewRef.current);return ()=>observer.disconnect()},[]);
  useEffect(()=>{
    if(!inView)return;
    let disposed=false,loadingTask,renderTask;
    setPreview({url,image:'',failed:false});
    async function renderFirstPage() {
      try {
        const {pdfjs}=await import('./pdf-runtime.js');
        if(disposed)return;
        loadingTask=pdfjs.getDocument({url});
        const pdf=await loadingTask.promise;
        if(disposed)return;
        const page=await pdf.getPage(1);
        if(disposed)return;
        const original=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:Math.min(1200/original.width,1600/original.height)});
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'});
        await renderTask.promise;
        if(!disposed)setPreview({url,image:canvas.toDataURL('image/png'),failed:false});
      } catch(error) {
        if(!disposed)setPreview({url,image:'',failed:true});
      } finally {
        if(!disposed && loadingTask)await loadingTask.destroy();
      }
    }
    renderFirstPage();
    return ()=>{disposed=true;renderTask?.cancel();loadingTask?.destroy().catch(()=>{})};
  },[url,inView]);
  const current=preview.url===url?preview:{image:'',failed:false};
  return <a ref={previewRef} className="pdf-preview" href={url} target="_blank" rel="noreferrer" aria-label={`Open PDF: ${title}`}>
    {current.image ? <img src={current.image} alt={`First page of ${title}`}/> : <span className="pdf-preview-placeholder" role="status">{current.failed?'Preview unavailable · Open PDF ↗':'Loading first page…'}</span>}
    <span className="pdf-preview-overlay"><strong>{title}</strong><span>{subject}</span></span>
  </a>;
}
function deadlineLabel(date){const today=todayISO();return date<today?'Past deadline':date===today?'Due today':date===offsetDate(today,1)?'Due tomorrow':'Due'}
function AssignmentsPage({items,onAdd,onDelete,initialCourse='all'}) {
  const canEdit=useContext(Access),[open,setOpen]=useState(false);
  const courses=useContext(Catalog);
  const [selectedCourse,setCourse]=useState(initialCourse),[period,setPeriod]=useState('all'),[sort,setSort]=useState('due'),[limit,setLimit]=useState(24);
  const visible=items.filter(a=>(selectedCourse==='all'||(a.courseId||'')===selectedCourse)&&(period==='all'||(period==='upcoming'?a.dueDate>=todayISO():a.dueDate<todayISO()))).sort((a,b)=>sort==='recent'?(b.createdAt||'').localeCompare(a.createdAt||''):a.dueDate.localeCompare(b.dueDate));
  const groups=Object.groupBy(visible.slice(0,limit),a=>courseLabel(courses,a.courseId,a.subject?.trim() || 'General'));
  return <section className="page-grid"><FilterPanel><BrowseCourse value={selectedCourse} onChange={v=>{setCourse(v);setLimit(24)}}/><label>Deadline<select value={period} onChange={e=>{setPeriod(e.target.value);setLimit(24)}}><option value="all">All assignments</option><option value="upcoming">Upcoming</option><option value="past">Past deadlines</option></select></label><label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="due">Due date</option><option value="recent">Recently posted</option></select></label>{canEdit && <button className="primary" onClick={()=>setOpen(true)}>Add assignment</button>}</FilterPanel><div className="card document-panel"><div className="section-head"><h3>Assignments</h3><span className="count-pill">{visible.length} matching</span></div>{visible.length ? <div className="course-groups">{Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).map(([course,assignments])=><section className="course-group" key={course}><div className="section-head"><h3>{course}</h3><span className="count-pill">{assignments.length}</span></div><div className="assignment-grid">{assignments.map(a=><article className="assignment-card" key={a.id}><PdfPreview key={a.pdfUrl} url={a.pdfUrl} previewUrl={a.previewUrl} title={a.title} subject={courseLabel(courses,a.courseId,a.subject || 'General')}/><div className="assignment-body"><div className="assignment-top"><span className={`status-chip ${a.dueDate<todayISO()?'overdue':a.dueDate<=offsetDate(todayISO(),3)?'due-soon':''}`}>{deadlineLabel(a.dueDate)} · {fmtDate(a.dueDate,{month:'short',day:'numeric'})}</span></div><Posted value={a.createdAt}/>{a.description && <p className="clamp-text">{a.description}</p>}<a className="text-btn details-link" href={`#assignments?item=${encodeURIComponent(a.id)}&course=${encodeURIComponent(selectedCourse)}`}>Details & related material ↗</a><div className="assignment-footer"><span className="file-name" title={a.originalFileName}>{a.originalFileName}</span><div><a className="text-btn" href={a.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>{canEdit && <><button className="text-btn" onClick={()=>setOpen(a)}>Edit</button><button className="danger-btn" onClick={()=>onDelete(a.id)}>Delete</button></>}</div></div></div></article>)}</div></section>)}</div> : <Empty text="No assignments match these filters."/>}</div>{visible.length>limit && <button className="secondary load-more" onClick={()=>setLimit(n=>n+24)}>Show more assignments</button>}{open && canEdit && <AssignmentModal initial={typeof open==='object'?open:undefined} onClose={()=>setOpen(false)} onSave={async data=>{await onAdd(data,open?.id);setOpen(false)}}/>}</section>;
}
function buildCalendar(year,month) {
  const first=(new Date(year,month,1).getDay()+6)%7;
  return Array.from({length:42},(_,i)=>{const d=new Date(year,month,1-first+i);return {day:d.getDate(),date:localISO(d),current:d.getMonth()===month}});
}
function EventsPage({items,onAdd,onDelete,focusDate}) {
  const canEdit=useContext(Access),[cursor,setCursor]=useState(()=>new Date()),[selectedDate,setSelectedDate]=useState(todayISO()),[open,setOpen]=useState(false),[filter,setFilter]=useState('all');
  const [view,setView]=useState('month');
  const dayPanelRef=useRef(null);
  const selectDay=date=>{setSelectedDate(date);if(window.matchMedia('(max-width:700px)').matches)dayPanelRef.current?.scrollIntoView({block:'start'})};
  useEffect(()=>{if(validDate(focusDate)){setSelectedDate(focusDate);setCursor(new Date(`${focusDate}T12:00:00`));setFilter('all')}},[focusDate]);
  const visible=items.filter(e=>filter==='all' || e.type===filter);
  const monthItems=visible.filter(e=>e.date.startsWith(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`)).sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||''));
  const selected=visible.filter(e=>e.date===selectedDate);
  const shift=n=>{const next=new Date(cursor.getFullYear(),cursor.getMonth()+n,1);setCursor(next);setSelectedDate(localISO(next))};
  return <section className="page-grid">
    <div className="calendar-layout"><div className="card calendar-card"><div className="section-head"><h2>{cursor.toLocaleString('en-IN',{month:'long',year:'numeric'})}</h2><div className="calendar-nav"><FilterPanel compact><label className="calendar-filter">Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All events</option>{Object.entries(typeMeta).map(([key,m])=><option key={key} value={key}>{m.label}</option>)}</select></label></FilterPanel>{canEdit && <button className="primary" onClick={()=>setOpen(true)}>Add event</button>}<button className="secondary" onClick={()=>{setCursor(new Date());setSelectedDate(todayISO())}}>Today</button><button className="icon-btn" aria-label="Previous month" onClick={()=>shift(-1)}>‹</button><button className="icon-btn" aria-label="Next month" onClick={()=>shift(1)}>›</button></div></div><div className="legend"><span><i className="dot weekend"/>Weekend off</span>{Object.entries(typeMeta).map(([key,m])=><span key={key}><i className={`dot ${key}`}/>{m.label}</span>)}</div><div className="calendar-view-toggle"><button className="secondary" aria-pressed={view==='month'} onClick={()=>setView('month')}>Month</button><button className="secondary" aria-pressed={view==='agenda'} onClick={()=>setView('agenda')}>Agenda</button></div>{view==='agenda' && <div className="calendar-agenda">{monthItems.length?monthItems.map(e=><button className="upcoming-event" key={e.id} onClick={()=>selectDay(e.date)}><span className={`event-icon ${e.type}`}>{typeMeta[e.type]?.icon}</span><span><strong>{e.title}</strong><span>{fmtDate(e.date)} · {e.type==='assignment'?'Assignment due':eventTime(e)}</span></span></button>):<Empty text="No events this month match the filter."/>}</div>}<div className={`calendar-grid ${view==='agenda'?'is-hidden':''}`}>{dayNames.map(d=><div className="calendar-dow" key={d}>{d.slice(0,3)}</div>)}{buildCalendar(cursor.getFullYear(),cursor.getMonth()).map(cell=>{const allDayItems=items.filter(e=>e.date===cell.date);const dayItems=visible.filter(e=>e.date===cell.date).sort((a,b)=>eventPriority.indexOf(a.type)-eventPriority.indexOf(b.type));const state=calendarDayState(cell.date,allDayItems);const dayTypes=state.types;const primary=dayItems[0]?.type || state.primary;const palette=calendarColors[primary];return <button key={cell.date} className={`calendar-cell ${cell.current?'':'muted'} ${cell.date===selectedDate?'selected':''} ${cell.date===todayISO()?'is-today':''} ${primary?`has-event has-${primary}`:''} ${state.off?'is-off':''}`} style={palette?{'--day-accent':palette.accent,'--day-tint':palette.tint}:undefined} aria-pressed={cell.date===selectedDate} aria-label={`${fmtDate(cell.date)}${state.off?', Weekend off':''}, ${dayItems.length} events${dayItems.length ? ': '+dayItems.map(e=>`${typeMeta[e.type]?.label}: ${e.title}`).join(', ') : allDayItems.length?' (other events hidden by filter)':''}`} onClick={()=>selectDay(cell.date)}><span className="calendar-day-heading"><span className="day-num">{cell.day}</span><span className="day-markers" aria-hidden="true">{dayTypes.map(type=><i key={type} className={`dot ${type}`}/>)}</span></span>{dayItems.length>0 && <span className="mobile-event-count" aria-hidden="true">{dayItems.length}</span>}<span className="calendar-events">{dayItems.slice(0,3).map(e=><span key={e.id} className={`event-pill ${e.type}`} title={`${typeMeta[e.type]?.label}: ${e.title}`}>{typeMeta[e.type]?.label} · {e.title}</span>)}{dayItems.length>3 && <span className="more">+{dayItems.length-3} more</span>}</span></button>})}</div></div>
    <aside ref={dayPanelRef} className="card day-panel" aria-live="polite"><div className="section-head"><div><p className="eyebrow">SELECTED DAY</p><h3>{fmtDate(selectedDate)}</h3></div></div>{selected.length ? <div className="list">{selected.map(e=><div className="day-event" key={e.id}><span className={`event-icon ${e.type}`}>{typeMeta[e.type]?.icon}</span><div><strong>{e.title}</strong><EventDetails item={e}/><a className="text-btn" href={e.type==='assignment'?`#assignments?item=${encodeURIComponent(e.id.replace('assignment:',''))}`:`#events?item=${encodeURIComponent(e.id)}`}>Full details ↗</a>{e.type==='assignment' && <a className="text-btn" href={e.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>}</div>{canEdit && e.type!=='assignment' && <div className="item-actions"><button className="text-btn" onClick={()=>setOpen(e)}>Edit</button><button className="danger-btn" onClick={()=>onDelete(e.id)}>Delete</button></div>}</div>)}</div> : <Empty text={calendarDayState(selectedDate,items.filter(e=>e.date===selectedDate)).off?"Weekend off · No events scheduled.":items.some(e=>e.date===selectedDate)?"No events match this filter.":"No events for this day."}/>}</aside></div>

    {open && canEdit && <EventModal initial={typeof open==='object'?open:undefined} date={selectedDate} onClose={()=>setOpen(false)} onSave={async data=>{await onAdd(data,open?.id);setOpen(false)}}/>}
  </section>;
}
async function downloadTimetable(items) {
  const url=URL.createObjectURL(new Blob([renderTimetable(items)],{type:'image/svg+xml'}));
  try {
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('Unable to create the timetable image.');
    const downloadURL=URL.createObjectURL(blob),link=document.createElement('a');link.href=downloadURL;link.download='studenthub-timetable.png';link.click();setTimeout(()=>URL.revokeObjectURL(downloadURL),1000);
  } finally {URL.revokeObjectURL(url)}
}
function TimetablePage({items,revision,onSave}) {
  const courses=useContext(Catalog);
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return ()=>clearInterval(timer)},[]);
  const live=scheduleNow(items,now);
  const canEdit=useContext(Access),[selected,setSelected]=useState(null),[downloadError,setDownloadError]=useState('');
  const boundaries=useMemo(()=>timeBoundaries(items),[items]),times=boundaries.slice(0,-1);
  async function save(value) {
    const next=selected.entries.filter(x=>x.id!==selected.existing?.id);
    if(value.subject.trim()) next.push({id:selected.existing?.id || crypto.randomUUID(),day:selected.day,start:selected.time,...value});
    await onSave(next,selected.revision);setSelected(null);
  }
  return <section className="schedule-layout"><div className="card schedule-card"><div className="section-head"><span className="count-pill">{items.length} classes</span><button className="primary" onClick={async()=>{setDownloadError('');try{await downloadTimetable(items)}catch(err){setDownloadError(err.message)}}}>Download timetable (PNG)</button></div>{downloadError && <p className="form-error" role="alert">{downloadError}</p>}<ScheduleOverview items={items} revision={revision} onEdit={canEdit?setSelected:undefined}/><div className="schedule-scroll"><table className="schedule-table"><caption className="sr-only">Weekly class timetable. All times are campus local time (IST).</caption><thead><tr><th scope="col">Time</th>{dayNames.map(d=><th scope="col" key={d} className={dayNames[live.day-1]===d?'current-day':''}>{d}{dayNames[live.day-1]===d?' · Today':''}</th>)}</tr></thead><tbody>{times.map((time,timeIndex)=><tr key={time}><th scope="row">{clockLabel(time)}–{clockLabel(boundaries[timeIndex+1])}</th>{dayNames.map((d,i)=>{if(items.some(x=>x.day===i+1 && x.start<time && x.end>time))return null;const row=items.find(x=>x.day===i+1 && x.start===time);const content=row ? <span className="class-cell" style={{background:colorFor(row).fill,borderColor:colorFor(row).ink}}><strong>{classTitle(row)}{live.current?.id===row.id?' · Now':live.next?.id===row.id?' · Next':''}</strong><small className="class-meta">{clockLabel(row.start)}–{clockLabel(row.end)} · {row.room || 'Room TBA'}</small></span> : <span className="blank-cell">{canEdit?'+':'—'}</span>;return <td key={d} className={`${row?'occupied-slot':''} ${live.current?.id===row?.id && row?'current-class':live.next?.id===row?.id && row?'next-class':''}`} rowSpan={row?Math.max(1,boundaries.indexOf(row.end)-timeIndex):1}>{canEdit ? <button className="schedule-cell-button" aria-label={`${row?'Edit':'Add'} class, ${d} ${time}`} onClick={()=>setSelected({day:i+1,time,existing:row,entries:items,revision})}>{content}</button> : row?<a className="schedule-cell-link" href={`#timetable?item=${encodeURIComponent(row.id)}`}>{content}</a>:content}</td>})}</tr>)}</tbody></table></div><p className="helper">All times are campus local time (IST).</p></div>{selected && canEdit && <ClassModal selected={selected} onClose={()=>setSelected(null)} onSave={save}/>}</section>;
}

function Modal({title,eyebrow,onClose,children}) {
  const ref=useRef(null);
  const heading=React.useId();
  useEffect(()=>{const dialog=ref.current;const previous=document.activeElement;dialog.showModal();dialog.querySelector('input:not([type="hidden"]),textarea,select')?.focus();return ()=>{dialog.close();if(previous?.isConnected)previous.focus();else document.querySelector('.search-trigger')?.focus()}},[]);
  return <dialog ref={ref} className="hub-dialog" aria-labelledby={heading} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}}} onCancel={e=>{e.preventDefault();onClose()}}><div className="modal-head"><div><p className="eyebrow">{eyebrow}</p><h3 id={heading}>{title}</h3></div><button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</dialog>;
}
function useSubmit(onSave) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  async function submit(e,data) {e.preventDefault();if(saving)return;setSaving(true);setError('');try{await onSave(data)}catch(err){setError(err.message)}finally{setSaving(false)}}
  return {saving,error,submit};
}
function FormActions({saving,error,onClose,label='Publish'}) {return <>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':label}</button></div></>}
function LoginModal({configured,onClose,onLogin}) {
  const [form,setForm]=useState({username:'',password:''}),state=useSubmit(onLogin);
  return <Modal title="Administrator sign in" eyebrow="PUBLISH CAMPUS UPDATES" onClose={onClose}>{configured ? <form onSubmit={e=>state.submit(e,form)}><label>{cloudEnabled?'Email':'Username'}<input type={cloudEnabled?'email':'text'} autoFocus required autoComplete="username" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><FormActions {...state} onClose={onClose} label="Sign in"/></form> : <p className="helper">Administrator access has not been set up yet. Contact the person hosting your campus hub.</p>}</Modal>;
}
function AnnouncementModal({initial,onClose,onSave}) {
  const hub=useContext(HubContext);
  const [form,setForm]=useState({category:'general',important:false,source:'',courseId:'',eventId:'',...initial,title:initial?.title||'',body:initial?.body||''}),state=useSubmit(onSave);
  return <Modal title={initial?'Edit update':'Add update'} eyebrow="NEW CAMPUS UPDATE" onClose={onClose}><form onSubmit={e=>state.submit(e,form)}><label>Title<input autoFocus required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Friday’s class has moved"/></label><div className="form-row"><label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(updateCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><CourseSelect value={form.courseId} onChange={courseId=>setForm({...form,courseId})}/></div><label>Source (optional)<input maxLength={160} value={form.source} onChange={e=>setForm({...form,source:e.target.value})} placeholder="Department, office or club"/></label><label>Related calendar event<select value={form.eventId||''} onChange={e=>setForm({...form,eventId:e.target.value})}><option value="">None</option>{(hub.events||[]).map(event=><option key={event.id} value={event.id}>{event.date} · {event.title}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={!!form.important} onChange={e=>setForm({...form,important:e.target.checked})}/>Important update</label><label>Message<textarea required rows={5} maxLength={10000} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} placeholder="Share the details with students…"/></label><FormActions {...state} onClose={onClose}/></form></Modal>;
}
function AssignmentModal({initial,onClose,onSave}) {
  const [form,setForm]=useState(initial || {title:'',subject:'',dueDate:todayISO(),description:''}),[file,setFile]=useState(null),state=useSubmit(onSave);
  function submit(e) {const data=new FormData();['title','subject','dueDate','description','courseId','submissionUrl'].forEach(k=>data.append(k,form[k] || ''));if(file)data.append('pdf',file);state.submit(e,data)}
  return <Modal title={initial?'Edit assignment':'Add assignment'} eyebrow="SHARED COURSEWORK" onClose={onClose}><form onSubmit={submit}><div className="form-row"><label>Title<input autoFocus required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><CourseSelect value={form.courseId} legacy={form.subject} onChange={courseId=>setForm({...form,courseId})}/></div><div className="form-row"><label>Due date<input required type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})}/></label><label>{initial?'Replace PDF (optional) · up to 15 MB':'PDF · up to 15 MB'}<input required={!initial} type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label></div><label>Submission link (optional)<input type="url" maxLength={2000} value={form.submissionUrl||''} onChange={e=>setForm({...form,submissionUrl:e.target.value})}/></label><label>Instructions<textarea rows={4} maxLength={5000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><FormActions {...state} onClose={onClose}/></form></Modal>;
}
function EventModal({initial,date,onClose,onSave}) {
  const [form,setForm]=useState(initial || {title:'',date,type:'exam',startTime:'',endTime:'',location:'',description:''}),state=useSubmit(onSave);
  return <Modal title={initial?'Edit event':'Add event'} eyebrow="DATES FOR EVERYONE" onClose={onClose}><form onSubmit={e=>state.submit(e,{...form,courseId:['exam','test'].includes(form.type)?form.courseId:null})}><label>Title<input autoFocus required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Mathematics midterm"/></label><div className="form-row"><label>Date<input required type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value,courseId:['exam','test'].includes(e.target.value)?form.courseId:''})}>{Object.entries(typeMeta).filter(([k])=>k!=='assignment').map(([k,m])=><option key={k} value={k}>{m.label}</option>)}</select></label></div>{['exam','test'].includes(form.type) && <CourseSelect value={form.courseId} onChange={courseId=>setForm({...form,courseId})}/>}<div className="form-row"><label>Start time · IST<input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>End time · IST<input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div><p className="helper">Leave the time blank if it has not been announced yet.</p><label>Venue<input maxLength={200} value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="e.g. Main hall or Room A-204"/></label><label>Details<textarea rows={3} maxLength={5000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Syllabus, instructions or event details"/></label><FormActions {...state} onClose={onClose}/></form></Modal>;
}
function ClassModal({selected,onClose,onSave}) {
  const [hour,minute]=selected.time.split(':').map(Number);
  const defaultEnd=`${String(Math.min(hour+1,18)).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const [form,setForm]=useState({start:selected.time,subject:selected.existing?.subject || '',end:selected.existing?.end || defaultEnd,room:selected.existing?.room || '',color:selected.existing?.color || 'coral',courseId:selected.existing?.courseId||'',professor:selected.existing?.professor||'',classType:['Lab','Lecture','Tutorial'].find(type=>type.toLowerCase()===selected.existing?.classType?.toLowerCase())||'Lecture'}),state=useSubmit(onSave);
  return <Modal title={`${dayNames[selected.day-1]} · ${selected.time}`} eyebrow="EDIT SHARED CLASS" onClose={onClose}><form onSubmit={e=>state.submit(e,form)}>
    <label>Subject<input autoFocus maxLength={160} value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/></label>
    <div className="form-row"><label>Type<select value={form.classType} onChange={e=>setForm({...form,classType:e.target.value})}>{['Lab','Lecture','Tutorial'].map(type=><option key={type} value={type}>{type}</option>)}</select></label><label>Room<input maxLength={160} value={form.room} onChange={e=>setForm({...form,room:e.target.value})}/></label></div>
    <div className="form-row"><label>Start time<input required type="time" min="08:00" max="17:59" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label><label>End time<input required type="time" min={form.start} max="18:00" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></label></div>
    <label>Class color<select value={form.color} onChange={e=>setForm({...form,color:e.target.value})}>{Object.entries(classColors).map(([key,color])=><option key={key} value={key}>{color.label}</option>)}</select></label>
    <div className="color-preview" style={{background:colorFor(form).fill,borderColor:colorFor(form).ink}}>{form.subject?classTitle(form):'Class preview'}</div>
    <p className="helper">Leave the subject empty to remove this class.</p><FormActions {...state} onClose={onClose} label="Save class"/>
  </form></Modal>;
}
export { Home, SearchPalette, ItemDetail, ScheduleOverview, App, Access, Catalog, ResourcesPage, CourseSelect, AnnouncementsPage, AssignmentsPage, EventsPage, TimetablePage, EventDetails, EventModal, calendarDayState, buildCalendar };
export default App;

function CourseManager({onClose,onSave}) {
  const courses=useContext(Catalog),[editing,setEditing]=useState(null),[form,setForm]=useState({code:'',name:''});
  const state=useSubmit(async data=>{await onSave(data,editing);setEditing(null);setForm({code:'',name:''})});
  return <Modal title="Courses" onClose={onClose}><div className="course-admin-list">{courses.map(c=><div className="list-row" key={c.id}><div className="row-main"><strong>{c.code} · {c.name}</strong><small> ID: {c.id}</small></div><button type="button" className="text-btn" onClick={()=>{setEditing(c.id);setForm({code:c.code,name:c.name})}}>Edit</button></div>)}</div><form onSubmit={e=>state.submit(e,form)}><h4>{editing?'Edit course':'Add course'}</h4><div className="form-row"><label>Course code<input required maxLength={40} value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="e.g. CS101"/></label><label>Course name<input required maxLength={160} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Computer Science"/></label></div>{state.error && <p role="alert" className="form-error">{state.error}</p>}<div className="modal-actions">{editing && <button className="secondary" type="button" onClick={()=>{setEditing(null);setForm({code:'',name:''})}}>Cancel edit</button>}<button className="primary" disabled={state.saving}>{state.saving?'Saving…':editing?'Save course':'Add course'}</button></div></form></Modal>;
}
const resourceKinds=resourceTypes;
function ResourcesPage({items,onSave,onDelete,initialCourse='all'}) {
  const courses=useContext(Catalog),canEdit=useContext(Access),[filter,setFilter]=useState(initialCourse),[open,setOpen]=useState(false);
  const [kind,setKind]=useState('all'),[sort,setSort]=useState('recent'),[query,setQuery]=useState(''),[limit,setLimit]=useState(24);
  const visible=items.filter(item=>(filter==='all'||(item.courseId||'')===filter)&&(kind==='all'||(item.resourceType||item.kind)===kind)&&`${item.title} ${item.description} ${item.originalFileName||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):(b.createdAt||'').localeCompare(a.createdAt||''));
  return <section className="page-grid"><FilterPanel><label>Filter by course<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All courses</option><option value="">General / no course</option>{courses.map(c=><option value={c.id} key={c.id}>{c.code} · {c.name}</option>)}</select></label><label>Type<select value={kind} onChange={e=>{setKind(e.target.value);setLimit(24)}}><option value="all">All types</option>{Object.entries(resourceKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently added</option><option value="title">Title A–Z</option></select></label><label>Find material<input type="search" value={query} placeholder="Title, filename or description" onChange={e=>{setQuery(e.target.value);setLimit(24)}}/></label>{canEdit && <button className="primary" onClick={()=>setOpen(true)}>Add resource</button>}</FilterPanel><div className="card document-panel"><div className="section-head"><h3>Resources</h3><span className="count-pill">{visible.length} total</span></div>{visible.length?<div className="assignment-grid">{visible.slice(0,limit).map(item=><article className="assignment-card resource-card" key={item.id}>{item.pdfUrl && <PdfPreview key={item.pdfUrl} url={item.pdfUrl} previewUrl={item.previewUrl} title={item.title} subject={courseLabel(courses,item.courseId)}/>}<div><span className="count-pill">{resourceKinds[item.resourceType||item.kind]}</span>{!item.pdfUrl && <><h3>{item.title}</h3><p>{courseLabel(courses,item.courseId)}</p></>}</div><Posted value={item.createdAt}/>{item.description && <p className="clamp-text">{item.description}</p>}<a className="text-btn details-link" href={`#resources?item=${encodeURIComponent(item.id)}&course=${encodeURIComponent(filter)}`}>Resource details ↗</a><div className="assignment-footer"><div>{item.pdfUrl && <a className="text-btn" href={item.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>}{item.url && <a className="text-btn" href={item.url} target="_blank" rel="noreferrer">Open link ↗</a>}{canEdit && <><button className="text-btn" onClick={()=>setOpen(item)}>Edit</button><button className="danger-btn" onClick={()=>onDelete(item.id)}>Delete</button></>}</div></div></article>)}</div>:<Empty text="No resources match these filters. Try another course, type, or search term."/>}</div>{visible.length>limit && <button className="secondary load-more" onClick={()=>setLimit(n=>n+24)}>Show more resources</button>}{open && canEdit && <ResourceModal initial={typeof open==='object'?open:undefined} onClose={()=>setOpen(false)} onSave={async data=>{await onSave(data,open?.id);setOpen(false)}}/>}</section>;
}
function ResourceModal({initial,onClose,onSave}) {
  const [form,setForm]=useState(initial || {title:'',kind:'notes',courseId:'',description:'',url:''}),[file,setFile]=useState(null),state=useSubmit(onSave);
  function submit(e){const data=new FormData();['title','kind','resourceType','courseId','description','url'].forEach(k=>data.append(k,form[k] || ''));if(file)data.append('pdf',file);state.submit(e,data)}
  return <Modal title={initial?'Edit resource':'Add resource'} onClose={onClose}><form onSubmit={submit}><label>Title<input autoFocus required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><div className="form-row"><CourseSelect value={form.courseId} onChange={courseId=>setForm({...form,courseId})}/><label>Type<select value={form.resourceType||form.kind} onChange={e=>setForm({...form,resourceType:e.target.value,kind:['notes','book','reference','other'].includes(e.target.value)?e.target.value:'other'})}>{Object.entries(resourceKinds).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label></div><label>Notes or book reference<textarea rows={4} maxLength={10000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Author, book title, edition, chapters, or notes…"/></label><label>Web link (optional)<input type="url" maxLength={2000} value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></label><label>{initial?.pdfUrl?'Replace PDF (optional)':'PDF (optional)'} · up to 15 MB<input type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>{initial?.originalFileName && <p className="helper">Attached: {initial.originalFileName}</p>}<FormActions {...state} onClose={onClose}/></form></Modal>;
}
function SearchPalette({hub,onClose,onSelect}) {
  const [query,setQuery]=useState(''),[active,setActive]=useState(0);
  const found=useMemo(()=>query.trim()?searchHub(hub,query):[],[hub,query]);
  const groups=['Updates','Resources','Assignments','Calendar','Classes'].map(type=>({type,items:found.filter(r=>r.type===type)})).filter(g=>g.items.length);
  const results=groups.flatMap(g=>g.items),selected=Math.min(active,Math.max(0,results.length-1));
  useEffect(()=>{document.getElementById(`search-result-${selected}`)?.scrollIntoView({block:'nearest'})},[selected,query]);
  return <Modal title="Search the hub" onClose={onClose}><div className="search-palette"><label className="sr-only" htmlFor="hub-search">Search updates, resources, assignments, calendar and classes</label><input id="hub-search" autoFocus type="search" role="combobox" aria-autocomplete="list" aria-expanded={results.length>0} aria-controls="hub-search-results" aria-activedescendant={results.length?`search-result-${selected}`:undefined} value={query} placeholder="Try physics notes, exam, tomorrow…" onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setActive(n=>results.length?(n+(e.key==='ArrowDown'?1:-1)+results.length)%results.length:0)}if(e.key==='Enter'&&results[selected]){e.preventDefault();onSelect(results[selected])}}}/><p className="search-hint">↑ ↓ to browse · Enter to open · Esc to close</p><div role="status" className="sr-only">{query?`${results.length} results`:''}</div><div id="hub-search-results" role="listbox" aria-label="Search results" className="search-results">{groups.map(group=><div key={group.type} role="group" aria-label={group.type}><h4 aria-hidden="true">{group.type}</h4>{group.items.map(result=>{const index=results.indexOf(result);return <div role="option" id={`search-result-${index}`} aria-selected={index===selected} key={result.key} className={`search-result ${index===selected?'active':''}`} onMouseDown={e=>e.preventDefault()} onClick={()=>onSelect(result)}><strong>{result.title}</strong><span>{result.detail}</span></div>})}</div>)}</div>{!query && <div className="search-empty"><strong>One place to find what you need</strong><p>Search titles, course codes, filenames, rooms, and descriptions. Use “today” or “tomorrow” for dated information.</p><div className="search-suggestions">{['tomorrow','exam','notes','assignment'].map(q=><button className="secondary" key={q} onClick={()=>{setQuery(q);setActive(0);document.getElementById('hub-search').focus()}}>{q}</button>)}</div></div>}{query && !results.length && <Empty text="No matches. Try a course code, a shorter phrase, or another date."/>}</div></Modal>;
}
function ItemDetail({page,item,onClose,onNavigate}) {
  const hub=useContext(HubContext),courses=useContext(Catalog);
  const related=(hub.resources||[]).filter(r=>item.courseId && r.courseId===item.courseId && r.id!==item.id).slice(0,3);
  const event=(hub.events||[]).find(e=>e.id===item.eventId);
  return <Modal title={page==='timetable'?classTitle(item):item.title||item.subject} eyebrow={{announcements:'UPDATE',resources:'RESOURCE',assignments:'ASSIGNMENT',events:'CALENDAR',timetable:'CLASS'}[page]} onClose={onClose}><div className="item-detail"><div className="item-meta">{page!=='timetable' && item.courseId && <span>{courseLabel(courses,item.courseId)}</span>}{item.category && <span>{updateCategories[item.category]}</span>}{!!item.important && <span className="importance">Important</span>}{item.source && <span>{item.source}</span>}<Posted value={item.createdAt}/></div>{page==='assignments' && <p className="detail-date">Due {fmtDate(item.dueDate)}{item.dueDate<todayISO()?' · Past deadline':''}</p>}{page==='events' && <><p className="detail-date">{fmtDate(item.date)} · {typeMeta[item.type]?.label}</p><p>{eventTime(item)} · IST</p>{item.location && <p>Venue · {item.location}</p>}</>}{page==='timetable' && <><p className="detail-date">{dayNames[item.day-1]} · {fmtTime(item.start)}–{fmtTime(item.end)} IST</p><p>{item.room||'Room to be announced'}</p></>}{page==='resources' && <span className="count-pill">{resourceTypes[item.resourceType||item.kind]}</span>}{page!=='timetable' && <p className="detail-description">{item.body||item.description||'No additional instructions provided.'}</p>}<div className="detail-actions">{item.pdfUrl && <a className="primary download-link" href={item.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>}{item.url && <a className="secondary download-link" href={item.url} target="_blank" rel="noreferrer">Open link ↗</a>}{item.submissionUrl && <a className="secondary download-link" href={item.submissionUrl} target="_blank" rel="noreferrer">Submission page ↗</a>}{page==='assignments' && <button className="secondary" onClick={()=>onNavigate(`events?date=${item.dueDate}`)}>See deadline in calendar</button>}{event && <button className="secondary" onClick={()=>onNavigate(`events?item=${encodeURIComponent(event.id)}`)}>Related event · {event.title}</button>}{item.courseId && <button className="text-btn" onClick={()=>onNavigate(`resources?course=${encodeURIComponent(item.courseId)}`)}>All course resources ↗</button>}</div>{related.length>0 && <section className="related-material"><h4>Related course material</h4>{related.map(r=><button className="related-result" key={r.id} onClick={()=>onNavigate(`resources?item=${encodeURIComponent(r.id)}`)}><strong>{r.title}</strong><span>{resourceTypes[r.resourceType||r.kind]} ↗</span></button>)}</section>}</div></Modal>;
}
function ScheduleOverview({items,onEdit,revision}) {
  const [now,setNow]=useState(()=>new Date()),[day,setDay]=useState(()=>campusClock().day);
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return ()=>clearInterval(timer)},[]);
  const state=scheduleNow(items,now),rows=items.filter(x=>x.day===day).sort((a,b)=>a.start.localeCompare(b.start));
  const courses=useContext(Catalog);
  return <div className="schedule-overview"><div className="now-next"><div><span>Now</span><strong>{state.current?classTitle(state.current):'No class in progress'}</strong>{state.current && <small>Until {fmtTime(state.current.end)} · {state.current.room||'Room TBA'}</small>}</div><div><span>Next today</span><strong>{state.next?classTitle(state.next):'No more classes today'}</strong>{state.next && <small>{fmtTime(state.next.start)} · {state.next.room||'Room TBA'}</small>}</div></div><div className="day-schedule"><div className="day-tabs" aria-label="Schedule day">{dayNames.map((name,index)=><button className={`secondary ${day===index+1?'active':''}`} aria-pressed={day===index+1} key={name} onClick={()=>setDay(index+1)}>{name.slice(0,3)}{state.day===index+1?' · Today':''}</button>)}</div><div className="agenda-list">{rows.map(row=><div className={`agenda-row colored-class ${state.current?.id===row.id?'current-class':state.next?.id===row.id?'next-class':''}`} style={{'--class-ink':colorFor(row).ink,'--class-fill':colorFor(row).fill}} key={row.id}><div><a className="class-detail-link" href={`#timetable?item=${encodeURIComponent(row.id)}`}><strong>{classTitle(row)}</strong></a>{state.current?.id===row.id && <span className="importance">Now</span>}{state.next?.id===row.id && <span>Up next</span>}<small className="class-meta">{fmtTime(row.start)}–{fmtTime(row.end)} · {row.room||'Room TBA'}</small>{onEdit && <button className="text-btn" onClick={()=>onEdit({day:row.day,time:row.start,existing:row,entries:items,revision})}>Edit</button>}</div></div>)}{!rows.length && <Empty text="No classes scheduled for this day."/>}</div>{onEdit && <button className="secondary" onClick={()=>onEdit({day,time:'08:00',entries:items,revision})}>Add class</button>}</div></div>;
}
