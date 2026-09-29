import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(filename, legacyFile) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('notes','book','reference','other')), courseId TEXT REFERENCES courses(id) ON DELETE RESTRICT, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', pdfUrl TEXT NOT NULL DEFAULT '', originalFileName TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule (id TEXT PRIMARY KEY, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7), start TEXT NOT NULL, end TEXT NOT NULL, subject TEXT NOT NULL, room TEXT NOT NULL DEFAULT '', UNIQUE(day,start));
    CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', dueDate TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', pdfUrl TEXT NOT NULL, originalFileName TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('custom','test','exam','fest','holiday')), description TEXT NOT NULL DEFAULT '', startTime TEXT NOT NULL DEFAULT '', endTime TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS administrators (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, adminId TEXT NOT NULL REFERENCES administrators(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS assignments_due ON assignments(dueDate);
    CREATE INDEX IF NOT EXISTS events_date ON events(date,startTime);
    CREATE INDEX IF NOT EXISTS announcements_created ON announcements(createdAt);
    INSERT OR IGNORE INTO metadata VALUES ('scheduleRevision', '0');`);

  if (!db.prepare('PRAGMA table_info(schedule)').all().some(column=>column.name==='color')) db.exec("ALTER TABLE schedule ADD COLUMN color TEXT NOT NULL DEFAULT 'coral'");
  for (const table of ['assignments','events']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='courseId')) db.exec(`ALTER TABLE ${table} ADD COLUMN courseId TEXT REFERENCES courses(id) ON DELETE RESTRICT`);
  }
  // Additive migrations preserve existing records and uploaded files.
  const additions={
    announcements:{category:"TEXT NOT NULL DEFAULT 'general'",important:'INTEGER NOT NULL DEFAULT 0',source:"TEXT NOT NULL DEFAULT ''",courseId:'TEXT REFERENCES courses(id) ON DELETE RESTRICT',eventId:'TEXT REFERENCES events(id) ON DELETE SET NULL'},
    resources:{resourceType:"TEXT NOT NULL DEFAULT ''"},
    assignments:{submissionUrl:"TEXT NOT NULL DEFAULT ''"},
    schedule:{courseId:'TEXT REFERENCES courses(id) ON DELETE RESTRICT',professor:"TEXT NOT NULL DEFAULT ''",classType:"TEXT NOT NULL DEFAULT ''"}
  };
  for(const [table,fields] of Object.entries(additions)) for(const [name,definition] of Object.entries(fields)) {
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  const columns = {
    courses:['id','code','name'],
    resources:['resourceType','id','title','kind','courseId','description','url','pdfUrl','originalFileName','createdAt'],
    schedule:['courseId','professor','classType','id','day','start','end','subject','room','color'],
    assignments:['submissionUrl','id','title','subject','dueDate','description','pdfUrl','originalFileName','createdAt','courseId'],
    events:['id','title','date','type','description','startTime','endTime','location','courseId'],
    announcements:['category','important','source','courseId','eventId','id','title','body','createdAt']
  };
  const order = { courses:'code', resources:'createdAt DESC,id', schedule:'day,start', assignments:'dueDate,id', events:'date,startTime,id', announcements:'createdAt DESC,id' };
  function table(name) { if (!columns[name]) throw new Error('Unknown collection'); return name; }
  function insert(name, row) {
    table(name);
    const keys = columns[name];
    db.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k] ?? (['courseId','eventId'].includes(k)?null:k==='important'?0:k==='category'?'general':k==='color'?'coral':'')));
    return row;
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value=fn(); db.exec('COMMIT'); return value; }
    catch(err) { db.exec('ROLLBACK'); throw err; }
  }
  // A marker and one transaction make legacy import safe across restarts.
  try { transaction(() => {
    if (db.prepare("SELECT value FROM metadata WHERE key='legacyImported'").get()) return;
    if (legacyFile && fs.existsSync(legacyFile)) {
      const legacy = JSON.parse(fs.readFileSync(legacyFile,'utf8'));
      for (const name of Object.keys(columns)) for (const row of legacy[name] || []) insert(name,row);
    }
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('legacyImported',new Date().toISOString());
  }); } catch(err) { db.close(); throw err; }
  const list = name => db.prepare(`SELECT * FROM ${table(name)} ORDER BY ${order[name]}`).all();
  const revision = () => Number(db.prepare("SELECT value FROM metadata WHERE key='scheduleRevision'").get().value);
  return {
    db, insert, list, revision,
    find(name,id) { return db.prepare(`SELECT * FROM ${table(name)} WHERE id=?`).get(id); },
    update(name,id,values) {
      table(name);
      const keys=columns[name].filter(key=>key!=='id' && Object.hasOwn(values,key));
      return db.prepare(`UPDATE ${name} SET ${keys.map(key=>`${key}=?`).join(',')} WHERE id=? RETURNING *`).get(...keys.map(key=>values[key]),id);
    },
    snapshot() { return transaction(()=>({courses:list('courses'),resources:list('resources'),schedule:list('schedule'),assignments:list('assignments'),events:list('events'),announcements:list('announcements'),scheduleRevision:revision()})); },
    remove(name,id) { return db.prepare(`DELETE FROM ${table(name)} WHERE id=? RETURNING *`).get(id); },
    replaceSchedule(entries,expected) {
      return transaction(()=>{
        if (expected !== revision()) { const error=new Error('The timetable changed. Refresh and try again.'); error.status=409; throw error; }
        db.exec('DELETE FROM schedule');
        for (const row of entries) insert('schedule',row);
        db.prepare("UPDATE metadata SET value=? WHERE key='scheduleRevision'").run(String(expected+1));
        return {schedule:list('schedule'),scheduleRevision:revision()};
      });
    },
    close() { db.close(); }
  };
}
