import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password,hash) {
  const [salt,expected] = hash.split(':');
  const actual = crypto.scryptSync(password,salt,64);
  return crypto.timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
export const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

export function installAuth(app,store,{secure=false,origin,developmentOrigins=[]}={}) {
  const db=store.db;
  const dummyHash=hashPassword(crypto.randomBytes(32).toString('hex'));
  const attempts=new Map();
  const cookieOptions={httpOnly:true,sameSite:'strict',secure,path:'/'};
  const sessionAge=8*60*60*1000;
  app.use('/api',(req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
      const allowed=origin || `${req.protocol}://${req.get('host')}`;
      if (![allowed,...developmentOrigins].includes(req.headers.origin)) return res.status(403).json({error:'Request origin is not allowed.'});
    }
    const cookie=(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('hub_session='));
    const token=cookie?.slice('hub_session='.length);
    if(token) req.admin=db.prepare('SELECT administrators.id, username FROM sessions JOIN administrators ON adminId=administrators.id WHERE tokenHash=? AND expiresAt>?').get(tokenHash(token),Date.now());
    req.sessionToken=token;
    next();
  });
  app.get('/api/auth/session',(req,res)=>{
    res.set('Cache-Control','no-store').json({admin:req.admin || null,configured:!!db.prepare('SELECT id FROM administrators LIMIT 1').get()});
  });
  app.post('/api/auth/login',(req,res)=>{
    const now=Date.now(), key=req.socket.remoteAddress;
    for(const [ip,value] of attempts) if(value.until<=now) attempts.delete(ip);
    const attempt=attempts.get(key) || {count:0,until:now+15*60*1000};
    if(attempt.count>=10) return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});
    attempt.count++; attempts.set(key,attempt);
    const username=typeof req.body.username==='string' ? req.body.username.trim().toLowerCase() : '';
    const password=typeof req.body.password==='string' ? req.body.password : '';
    if(password.length>256) return res.status(400).json({error:'Invalid sign-in details.'});
    const admin=db.prepare('SELECT * FROM administrators WHERE username=?').get(username);
    const matches=verifyPassword(password,admin?.passwordHash || dummyHash);
    if(!admin || !matches) return res.status(401).json({error:'Incorrect username or password.'});
    attempts.delete(key);
    db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(now);
    if(req.sessionToken) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(tokenHash(req.sessionToken));
    const token=crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token),admin.id,now+sessionAge);
    res.cookie('hub_session',token,{...cookieOptions,maxAge:sessionAge}).json({admin:{id:admin.id,username:admin.username}});
  });
  app.post('/api/auth/logout',(req,res)=>{
    if(req.sessionToken) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(tokenHash(req.sessionToken));
    res.clearCookie('hub_session',cookieOptions).status(204).end();
  });
  // Enforce permissions on the server, including multipart uploads.
  app.use('/api',(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && !req.admin) return res.status(401).json({error:'Administrator sign-in is required to make changes.'});
    next();
  });
}
