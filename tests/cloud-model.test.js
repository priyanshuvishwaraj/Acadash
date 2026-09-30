import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHub, mutateHub } from '../supabase/functions/_shared/model.js';

test('cloud assignment closure survives edits and can be reopened without replacing the PDF',()=>{
  const body={title:'Coursework',dueDate:'2099-10-02'};
  const first=mutateHub(emptyHub(),'assignments','POST',undefined,body,{assetId:'file',pdfUrl:'https://example.com/work.pdf'});
  assert.equal(first.result.closed,0);
  const closed=mutateHub(first.hub,'assignments','PUT',first.result.id,{...body,closed:'1'});
  assert.equal(closed.result.closed,1);
  const edited=mutateHub(closed.hub,'assignments','PUT',first.result.id,body);
  assert.equal(edited.result.closed,1);assert.equal(edited.result.assetId,'file');assert.equal(edited.retired,null);
  const reopened=mutateHub(edited.hub,'assignments','PUT',first.result.id,{...body,closed:'0'});
  assert.equal(reopened.result.closed,0);
  assert.throws(()=>mutateHub(first.hub,'assignments','PUT',first.result.id,{...body,closed:'yes'}),/valid assignment status/);
});

test('cloud permissions cannot be forged through attachment form fields', () => {
  const payload = { title: 'Notes', description: 'Reading', pdfUrl: 'https://evil.test', assetId: 'someone-elses-file' };
  const { result } = mutateHub(emptyHub(), 'resources', 'POST', undefined, payload);
  assert.equal(result.pdfUrl, ''); assert.equal(result.assetId, undefined);
  assert.throws(() => mutateHub(emptyHub(), 'assignments', 'POST', undefined, { title: 'Assignment', dueDate: '2026-09-30', pdfUrl: 'https://evil.test' }), /Attach a PDF/);
});
test('replacement and deletion retire the exact previous attachment', () => {
  const first = mutateHub(emptyHub(), 'resources', 'POST', undefined, { title: 'Notes' }, { assetId: 'old', pdfUrl: 'https://drive.google.com/old', previewUrl: 'old.webp' });
  const edited = mutateHub(first.hub, 'resources', 'PUT', first.result.id, { title: 'Updated' }, { assetId: 'new', pdfUrl: 'https://drive.google.com/new' });
  assert.equal(edited.retired, 'old');
  const removed = mutateHub(edited.hub, 'resources', 'DELETE', first.result.id);
  assert.equal(removed.retired, 'new'); assert.equal(removed.hub.resources.length, 0);
  assert.equal(first.hub.resources[0].assetId, 'old');
});
test('metadata-only edit preserves attachments', () => {
  const first = mutateHub(emptyHub(), 'resources', 'POST', undefined, { title: 'Notes' }, { assetId: 'old', pdfUrl: 'https://drive.google.com/old', previewUrl: 'old.webp' });
  const edited = mutateHub(first.hub, 'resources', 'PUT', first.result.id, { title: 'New title' });
  assert.equal(edited.result.assetId, 'old'); assert.equal(edited.retired, null);
});
test('timetable rejects stale revisions and overlapping classes', () => {
  const row = { day: 1, start: '09:00', end: '10:00', subject: 'Math' };
  const change = mutateHub(emptyHub(), 'schedule', 'PUT', undefined, { entries: [row], revision: 0 });
  assert.equal(change.hub.scheduleRevision, 1);
  assert.throws(() => mutateHub(change.hub, 'schedule', 'PUT', undefined, { entries: [], revision: 0 }), /timetable changed/);
  assert.throws(() => mutateHub(emptyHub(), 'schedule', 'PUT', undefined, { entries: [row, { ...row, start: '09:30' }], revision: 0 }), /overlap/);
});
test('cloud validation rejects bad dates, unsafe links and missing references', () => {
  assert.throws(() => mutateHub(emptyHub(), 'events', 'POST', undefined, { title: 'Test', date: '2026-02-30' }), /valid date/);
  assert.throws(() => mutateHub(emptyHub(), 'resources', 'POST', undefined, { title: 'Notes', url: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => mutateHub(emptyHub(), 'announcements', 'POST', undefined, { title: 'News', body: 'Hi', courseId: 'missing' }), /existing course/);
});
test('course deletion protects references and event deletion clears links', () => {
  const hub = emptyHub(); hub.courses = [{ id: 'c', code: 'M', name: 'Math' }]; hub.events = [{ id: 'e', courseId: 'c' }]; hub.announcements = [{ id: 'a', eventId: 'e' }];
  assert.throws(() => mutateHub(hub, 'courses', 'DELETE', 'c'), /in use/);
  const change = mutateHub(hub, 'events', 'DELETE', 'e');
  assert.equal(change.hub.announcements[0].eventId, null);
});
