import { renderTimetable } from '../client/src/timetable.js';
export function installScheduleRender(app,store) {
  app.get('/api/schedule/render',(_req,res)=>{
    res.set('Cache-Control','no-store').type('image/svg+xml').send(renderTimetable(store.list('schedule')));
  });
}
