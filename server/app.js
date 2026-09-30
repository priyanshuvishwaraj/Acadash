import { updateCategories, resourceTypes } from '../client/src/discovery.js';
import { classColors } from '../client/src/timetable.js';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { installAuth } from './auth.js';
import { installScheduleRender } from './render.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function invalid(message) { const err=new Error(message); err.status=400; throw err; }
function text(value,max=5000) { if(value!=null && typeof value!=='string') invalid('Text fields must contain text.'); const s=(value || '').trim(); if(s.length>max) invalid(`Text must be ${max} characters or fewer.`); return s; }
function required(value,label,max=160) { const s=text(value,max); if(!s) invalid(`${label} is required.`); return s; }
function date(value) { const s=text(value,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)!==s) invalid('Enter a valid date.'); return s; }
function time(value) { const s=text(value,5); if(s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) invalid('Enter a valid time.'); return s; }

export function createApp({databasePath,legacyPath,uploadDir,secureCookies=false,origin,developmentOrigins=[]}) {
  const store=openDatabase(databasePath,legacyPath);
  fs.mkdirSync(uploadDir,{recursive:true});
  const app=express();
  app.disable('x-powered-by');
  app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');next()});
  app.use(express.json({limit:'2mb'}));
  app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next()});
  installAuth(app,store,{secure:secureCookies,origin,developmentOrigins});
  app.use('/uploads',express.static(uploadDir));
  const upload=multer({
    storage:multer.diskStorage({destination:uploadDir,filename:(_req,_file,cb)=>cb(null,`${crypto.randomUUID()}.pdf`)}),
    limits:{fileSize:15*1024*1024,files:1,fields:12},
    fileFilter:(_req,file,cb)=>{if(file.mimetype==='application/pdf' && path.extname(file.originalname).toLowerCase()==='.pdf') cb(null,true);else {const err=new Error('Only PDF files are supported.');err.status=400;cb(err);}}
  });
  app.get('/api/health',(_req,res)=>res.json({ok:true,database:'sqlite'}));
  app.get('/api/hub',(_req,res)=>res.json(store.snapshot()));
  for(const collection of ['schedule','assignments','events','announcements','courses','resources']) app.get(`/api/${collection}`,(_req,res)=>res.json(store.list(collection)));
  function courseId(value) {
    if(value==null || value==='') return null;
    const id=required(value,'Course',100);
    if(!store.find('courses',id)) invalid('Select an existing course.');
    return id;
  }
  function courseFields(body,id) {
    const code=required(body.code,'Course code',40).toUpperCase(),name=required(body.name,'Course name');
    if(store.list('courses').some(c=>c.code.toUpperCase()===code && c.id!==id)) invalid('This course code is already in use.');
    return {code,name};
  }
  app.post('/api/courses',(req,res)=>{
    const item={id:crypto.randomUUID(),...courseFields(req.body)};store.insert('courses',item);res.status(201).json(item);
  });
  app.put('/api/courses/:id',(req,res)=>{
    if(!store.find('courses',req.params.id))return res.status(404).json({error:'Course not found.'});
    res.json(store.update('courses',req.params.id,courseFields(req.body,req.params.id)));
  });
  app.delete('/api/courses/:id',(req,res)=>{
    if(['assignments','events','resources','announcements','schedule'].some(name=>store.list(name).some(row=>row.courseId===req.params.id))) return res.status(409).json({error:'This course is in use. Reassign its entries before deleting it.'});
    if(!store.remove('courses',req.params.id))return res.status(404).json({error:'Course not found.'});res.status(204).end();
  });
  function validatePDF(file) {
    if(!file)return;
    const fd=fs.openSync(file.path,'r'),signature=Buffer.alloc(5);
    try{fs.readSync(fd,signature,0,5,0)}finally{fs.closeSync(fd)}
    if(signature.toString()!=='%PDF-')invalid('The attachment is not a valid PDF.');
  }
  function saveResource(req,res,next) {
    try {
      const existing=req.params.id?store.find('resources',req.params.id):null;
      if(req.params.id && !existing){const err=new Error('Resource not found.');err.status=404;throw err;}
      validatePDF(req.file);
      const resourceType=req.body.resourceType || req.body.kind || 'notes';if(!Object.hasOwn(resourceTypes,resourceType))invalid('Invalid resource type.');
      const kind=req.body.kind || 'notes';if(!['notes','book','reference','other'].includes(kind))invalid('Invalid resource type.');
      const url=text(req.body.url,2000),description=text(req.body.description,10000);
      if(url){let parsed;try{parsed=new URL(url)}catch{invalid('Enter a valid web link.')}if(!['https:','http:'].includes(parsed.protocol))invalid('Use an HTTP or HTTPS web link.');}
      if(!url && !description && !req.file && !existing?.pdfUrl)invalid('Add a PDF, link, or reference details.');
      const item={id:existing?.id || crypto.randomUUID(),title:required(req.body.title,'Title'),kind,resourceType,courseId:courseId(req.body.courseId),description,url,pdfUrl:req.file?`/uploads/${req.file.filename}`:existing?.pdfUrl || '',originalFileName:req.file?.originalname || existing?.originalFileName || '',createdAt:existing?.createdAt || new Date().toISOString()};
      if(existing)store.update('resources',existing.id,item);else store.insert('resources',item);
      res.status(existing?200:201).json(item);
    }catch(err){if(req.file)fs.rmSync(req.file.path,{force:true});next(err)}
  }
  app.post('/api/resources',upload.single('pdf'),saveResource);
  app.put('/api/resources/:id',upload.single('pdf'),saveResource);
  installScheduleRender(app,store);
  app.put('/api/schedule',(req,res)=>{
    const {entries,revision}=req.body;
    if(!Array.isArray(entries) || entries.length>500 || !Number.isInteger(revision)) invalid('Provide timetable entries and their revision.');
    const slots=new Set(),ids=new Set();
    const normalized=entries.map(row=>{
      const day=Number(row.day),start=time(row.start),end=time(row.end);
      if(!Number.isInteger(day) || day<1 || day>7 || !start || !end || end<=start) invalid('Each class needs a valid day and an end time after its start.');
      if(start<'08:00' || end>'18:00') invalid('Classes must be between 8 am and 6 pm.');
      if(entries.some(other=>other!==row && Number(other.day)===day && other.start<end && other.end>start)) invalid('Classes cannot overlap on the same day.');
      if(row.color!=null && !Object.hasOwn(classColors,row.color)) invalid('Choose a valid class color.');
      const slot=`${day}-${start}`; if(slots.has(slot)) invalid('Two classes cannot start in the same timetable cell.'); slots.add(slot);
      const id=row.id ? required(row.id,'ID',100) : crypto.randomUUID();
      if(ids.has(id)) invalid('Class IDs must be unique.'); ids.add(id);
      return {id,day,start,end,subject:required(row.subject,'Subject'),room:text(row.room,160),color:row.color || 'coral',courseId:courseId(row.courseId),professor:text(row.professor,160),classType:text(row.classType,60)};
    });
    res.json(store.replaceSchedule(normalized,revision));
  });
  function saveAssignment(req,res,next) {
    try {
      const existing=req.params.id ? store.find('assignments',req.params.id) : null;
      if(req.params.id && !existing) {const error=new Error('Assignment not found.');error.status=404;throw error;}
      if(!req.file && !existing) invalid('Attach a PDF assignment file.');
      if(req.file) {
        const fd=fs.openSync(req.file.path,'r'); const signature=Buffer.alloc(5);
        try { fs.readSync(fd,signature,0,5,0); } finally { fs.closeSync(fd); }
        if(signature.toString()!=='%PDF-') invalid('The attachment is not a valid PDF.');
      }
      const closed=req.body.closed ?? existing?.closed ?? 0;
      if(![true,false,0,1,'0','1'].includes(closed))invalid('Choose a valid assignment status.');
      const item={closed:Number(closed===true || closed===1 || closed==='1'),id:existing?.id || crypto.randomUUID(),title:required(req.body.title,'Title'),subject:text(req.body.subject,160),courseId:courseId(req.body.courseId),dueDate:date(req.body.dueDate),submissionUrl:webLink(req.body.submissionUrl),description:text(req.body.description),pdfUrl:req.file ? `/uploads/${req.file.filename}` : existing.pdfUrl,originalFileName:req.file?.originalname || existing.originalFileName,createdAt:existing?.createdAt || new Date().toISOString()};
      if(existing) store.update('assignments',existing.id,item);else store.insert('assignments',item);
      res.status(existing?200:201).json(item);
    } catch(err) { if(req.file) fs.rmSync(req.file.path,{force:true}); next(err); }
  }
  app.post('/api/assignments',upload.single('pdf'),saveAssignment);
  app.put('/api/assignments/:id',upload.single('pdf'),saveAssignment);
  function webLink(value) {const url=text(value,2000);if(url){let parsed;try{parsed=new URL(url)}catch{invalid('Enter a valid web link.')}if(!['http:','https:'].includes(parsed.protocol))invalid('Use an HTTP or HTTPS web link.');}return url;}
  function announcementFields(body) {
    const category=body.category || 'general';if(!Object.hasOwn(updateCategories,category))invalid('Choose a valid update category.');
    const eventId=body.eventId || null;if(eventId && !store.find('events',eventId))invalid('Related event not found.');
    if(body.important!=null && ![true,false,0,1].includes(body.important))invalid('Invalid importance.');
    return {title:required(body.title,'Title'),body:required(body.body,'Message',10000),category,important:body.important?1:0,source:text(body.source,160),courseId:courseId(body.courseId),eventId};
  }
  function eventFields(body) {
    const type=body.type || 'custom';
    if(!['custom','test','exam','fest','holiday'].includes(type)) invalid('Invalid event type.');
    const startTime=time(body.startTime),endTime=time(body.endTime);
    if(endTime && (!startTime || endTime<=startTime)) invalid('End time must be after start time.');
    return {title:required(body.title,'Title'),date:date(body.date),type,description:text(body.description),startTime,endTime,location:text(body.location,200),courseId:['test','exam'].includes(type)?courseId(body.courseId):null};
  }
  for(const [collection,fields] of [['announcements',announcementFields],['events',eventFields]]) {
    app.post(`/api/${collection}`,(req,res)=>{
      const item={id:crypto.randomUUID(),...fields(req.body),...(collection==='announcements'?{createdAt:new Date().toISOString()}:{})};
      store.insert(collection,item);res.status(201).json(item);
    });
    app.put(`/api/${collection}/:id`,(req,res)=>{
      const item=store.update(collection,req.params.id,fields(req.body));
      if(!item) return res.status(404).json({error:'Item not found.'});
      res.json(item);
    });
  }
  for(const collection of ['assignments','events','announcements','resources']) app.delete(`/api/${collection}/:id`,(req,res)=>{
    const removed=store.remove(collection,req.params.id);
    if(!removed) return res.status(404).json({error:'Item not found.'});
    // Retain retired PDFs for backup/recovery until explicit storage maintenance.
    res.status(204).end();
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found.'}));
  const dist=path.join(ROOT,'client','dist');
  if(fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req,res,next)=>{if(req.method==='GET' && !req.path.startsWith('/uploads/')) res.sendFile(path.join(dist,'index.html'));else next()});
  }
  app.use((err,_req,res,_next)=>{
    const status=err.status || (err instanceof multer.MulterError ? 400 : 500);
    if(status>=500) console.error(err);
    res.status(status).json({error:status>=500 ? 'Unable to save this change. Please try again.' : err.message});
  });
  return {app,store};
}
