import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const {app,store}=createApp({databasePath:process.env.DATABASE_PATH || path.join(root,'data','hub.sqlite'),legacyPath:process.env.LEGACY_PATH || path.join(root,'data','db.json'),uploadDir:process.env.UPLOAD_DIR || path.join(root,'uploads'),secureCookies:process.env.NODE_ENV==='production',origin:process.env.APP_ORIGIN,developmentOrigins:process.env.NODE_ENV==='production'?[]:['http://localhost:5173','http://127.0.0.1:5173']});
const server=app.listen(Number(process.env.PORT || 4000),process.env.HOST || '0.0.0.0',()=>console.log(`Campus Hub listening on port ${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0)}));
