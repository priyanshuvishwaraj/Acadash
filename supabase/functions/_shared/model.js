export const collections = ['courses', 'resources', 'assignments', 'events', 'announcements', 'schedule'];
export const emptyHub = () => Object.fromEntries([...collections.map(k => [k, []]), ['scheduleRevision', 0]]);
/** @returns {never} */
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(v, max = 5000) { if (v != null && typeof v !== 'string') fail('Expected text.'); const s = (v || '').trim(); if (s.length > max) fail(`Text must be ${max} characters or fewer.`); return s; }
function required(v, label, max = 160) { const s = text(v, max); if (!s) fail(`${label} is required.`); return s; }
function choice(v, values, fallback) { const s = v || fallback; if (!values.includes(s)) fail('Invalid category or type.'); return s; }
function date(v) { const s = text(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) fail('Enter a valid date.'); return s; }
function time(v) { const s = text(v, 5); if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) fail('Enter a valid time.'); return s; }
function link(v) { const s = text(v, 2000); if (s) { let u; try { u = new URL(s); } catch { fail('Enter a valid web link.'); } if (!['http:', 'https:'].includes(u.protocol)) fail('Use an HTTP or HTTPS link.'); } return s; }

// Only normalized fields reach the public snapshot. Attachment ownership comes from
// the backend, never from form-supplied URLs or Drive IDs.
/** @param {Record<string, any> | null} attachment */
export function mutateHub(input, collection, method, id, body = {}, attachment = null) {
  if (!collections.includes(collection)) fail('Unknown collection.', 404);
  const hub = structuredClone(input);
  const old = hub[collection].find(row => row.id === id);
  if (id && !old) fail('Item not found.', 404);
  const courseId = value => { const s = text(value, 100); if (s && !hub.courses.some(c => c.id === s)) fail('Select an existing course.'); return s || null; };
  if (method === 'DELETE') {
    if (!old || collection === 'schedule') fail('Item not found.', 404);
    if (collection === 'courses' && collections.some(k => k !== 'courses' && hub[k].some(r => r.courseId === id))) fail('This course is in use.', 409);
    hub[collection] = hub[collection].filter(r => r.id !== id);
    if (collection === 'events') hub.announcements = hub.announcements.map(r => r.eventId === id ? { ...r, eventId: null } : r);
    return { hub, result: null, retired: old.assetId || null };
  }
  if (!['POST', 'PUT'].includes(method) || (collection !== 'schedule' && ((method === 'PUT') !== !!id))) fail('Unsupported operation.', 405);
  if (collection === 'schedule') {
    if (method !== 'PUT' || !Array.isArray(body.entries) || body.entries.length > 500) fail('Provide up to 500 timetable entries.');
    if (!Number.isInteger(body.revision) || body.revision !== hub.scheduleRevision) fail('The timetable changed. Refresh and try again.', 409);
    const ids = new Set();
    const entries = body.entries.map(row => {
      const start = time(row.start), end = time(row.end), day = Number(row.day);
      if (!Number.isInteger(day) || day < 1 || day > 7 || !start || !end || end <= start || start < '08:00' || end > '18:00') fail('Classes must have valid times between 8 am and 6 pm.');
      const rowId = row.id ? required(row.id, 'ID', 100) : crypto.randomUUID();
      if (ids.has(rowId)) fail('Class IDs must be unique.'); ids.add(rowId);
      return { id: rowId, day, start, end, subject: required(row.subject, 'Subject'), room: text(row.room, 160), color: choice(row.color, ['coral','blue','green','purple','gold','teal'], 'coral'), courseId: courseId(row.courseId), professor: text(row.professor, 160), classType: text(row.classType, 60) };
    });
    if (entries.some((r, i) => entries.some((s, j) => i !== j && r.day === s.day && r.start < s.end && r.end > s.start))) fail('Classes cannot overlap on the same day.');
    hub.schedule = entries; hub.scheduleRevision++;
    return { hub, result: { schedule: entries, scheduleRevision: hub.scheduleRevision }, retired: null };
  }
  let fields;
  if (collection === 'courses') {
    const code = required(body.code, 'Course code', 40).toUpperCase();
    if (hub.courses.some(c => c.id !== id && c.code.toUpperCase() === code)) fail('Course code already exists.');
    fields = { code, name: required(body.name, 'Course name') };
  } else {
    fields = { title: required(body.title, 'Title'), courseId: courseId(body.courseId) };
    if (collection === 'announcements') {
      if (body.important != null && ![true,false,0,1].includes(body.important)) fail('Invalid importance.');
      const eventId = text(body.eventId, 100) || null;
      if (eventId && !hub.events.some(e => e.id === eventId)) fail('Related event not found.');
      Object.assign(fields, { body: required(body.body, 'Message', 10000), category: choice(body.category, ['general','academic','exam','assignment','schedule','event','club','administrative'], 'general'), important: body.important ? 1 : 0, source: text(body.source, 160), eventId });
    } else if (collection === 'events') {
      const startTime = time(body.startTime), endTime = time(body.endTime);
      if (endTime && (!startTime || endTime <= startTime)) fail('End time must be after start time.');
      Object.assign(fields, { date: date(body.date), type: choice(body.type, ['custom','test','exam','fest','holiday'], 'custom'), startTime, endTime, location: text(body.location, 200), description: text(body.description) });
    } else {
      const file = attachment || (old ? Object.fromEntries(['assetId','pdfUrl','previewUrl','originalFileName'].map(k => [k, old[k] || ''])) : { pdfUrl: '', previewUrl: '', originalFileName: '' });
      Object.assign(fields, file, { description: text(body.description, collection === 'resources' ? 10000 : 5000) });
      if (collection === 'assignments') {
        if (!fields.pdfUrl) fail('Attach a PDF assignment file.');
        Object.assign(fields, { subject: text(body.subject, 160), dueDate: date(body.dueDate), submissionUrl: link(body.submissionUrl) });
      } else {
        Object.assign(fields, { url: link(body.url), kind: choice(body.kind, ['notes','book','reference','other'], 'notes'), resourceType: choice(body.resourceType || body.kind, ['notes','lecture','paper','syllabus','lab','book','reference','assignment','link','other'], 'notes') });
        if (!fields.pdfUrl && !fields.url && !fields.description) fail('Add a PDF, link or reference details.');
      }
    }
  }
  const result = { id: old?.id || crypto.randomUUID(), ...fields, ...(collection !== 'courses' ? { createdAt: old?.createdAt || new Date().toISOString() } : {}) };
  hub[collection] = old ? hub[collection].map(r => r.id === id ? result : r) : [result, ...hub[collection]];
  return { hub, result, retired: attachment && old?.assetId || null };
}
