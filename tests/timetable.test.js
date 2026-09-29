import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTimetable,timeBoundaries} from '../client/src/timetable.js';
test('download renders supplied current content, times, colors and escapes text',()=>{
 const entry={day:1,start:'08:30',end:'10:00',subject:'Maths <updated>',room:'A&B',color:'purple'};
 const first=renderTimetable([entry]);
 assert.match(first,/Maths &lt;updated&gt;/);assert.match(first,/A&amp;B/);assert.match(first,/#efe5fc/);assert.match(first,/8:30 am–10 am/);assert.match(first,/6 pm/);
 assert.notEqual(first,renderTimetable([{...entry,subject:'New course',color:'green'}]));
 assert.deepEqual(timeBoundaries([entry]).slice(0,3),['08:00','08:30','09:00']);
});
