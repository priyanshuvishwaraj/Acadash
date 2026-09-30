export const classTitle=row=>`${row.subject}${row.classType?' ('+row.classType+')':''}`;
export const classColors={coral:{label:'Coral',ink:'#a53929',fill:'#fce8e2'},blue:{label:'Blue',ink:'#246499',fill:'#e7f1fc'},green:{label:'Green',ink:'#247645',fill:'#e5f4e9'},purple:{label:'Purple',ink:'#69409e',fill:'#efe5fc'},gold:{label:'Gold',ink:'#8e600e',fill:'#fff0d7'},teal:{label:'Teal',ink:'#286d73',fill:'#e7f3f3'}};
export const colorFor=row=>classColors[row.color] || classColors.coral;
export const clockLabel=time=>{const [h,m]=time.split(':').map(Number);return `${h%12||12}${m?':'+String(m).padStart(2,'0'):''} ${h<12?'am':'pm'}`};
export function timeBoundaries(items){return [...new Set([...Array.from({length:11},(_,i)=>`${String(i+8).padStart(2,'0')}:00`),...items.flatMap(x=>[x.start,x.end]).filter(t=>t>='08:00'&&t<='18:00')])].sort()}
export function renderTimetable(items){
 const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const slots=timeBoundaries(items),width=1900,left=180,col=238,rowH=120,top=210,height=top+(slots.length-1)*rowH+65;
 const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const text=(x,y,v,size=18,color='#647268',weight=500)=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(v)}</text>`;
 const wrap=v=>String(v||'').match(/.{1,23}(?:\s|$)|.{1,23}/g)||[];
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fafbf8"/><rect x="16" y="16" width="${width-32}" height="${height-32}" rx="28" fill="#ffffff"/>`;
 svg+=text(44,65,'StudentHub',26,'#204f40',700)+text(44,112,'Weekly timetable',34,'#292929',600)+text(44,185,'Time',18,'#204f40',600);
 days.forEach((d,i)=>{svg+=`<rect x="${left+i*col}" y="150" width="${col-10}" height="48" rx="10" fill="#edf3e7"/>`+text(left+i*col+14,181,d,18,'#204f40',600)});
 slots.slice(0,-1).forEach((time,i)=>{
  const y=top+i*rowH;
  svg+=text(44,y+35,clockLabel(time),18)+text(44,y+60,'– '+clockLabel(slots[i+1]),16);
  days.forEach((_,day)=>{
   if(items.some(r=>r.day===day+1&&r.start<time&&r.end>time))return;
   const item=items.find(r=>r.day===day+1&&r.start===time),span=item?Math.max(1,slots.indexOf(item.end)-i):1;
   const x=left+day*col,h=span*rowH-10,c=item?colorFor(item):{fill:'#fff',ink:'#e4e8e2'};
   svg+=`<rect x="${x}" y="${y}" width="${col-10}" height="${h}" rx="12" fill="${c.fill}" stroke="#e4e8e2"/>`;
   if(item){
    svg+=`<path d="M ${x+12} ${y+h-7} H ${x+col-22}" stroke="${c.ink}" stroke-width="3"/>`;
    const lines=[...wrap(classTitle(item)).map(t=>({t,weight:600})),{t:`${clockLabel(item.start)}–${clockLabel(item.end)}`,weight:400},...wrap(item.room).map(t=>({t,weight:400}))];
    const size=Math.min(18,(h-24)/lines.length/1.3);
    lines.forEach((l,j)=>svg+=text(x+14,y+20+j*size*1.3,l.t,size,'#292929',l.weight));
   }
  });
 });
 return svg+text(44,height-28,'All times IST · 8 am–6 pm',14)+'</svg>';
}
