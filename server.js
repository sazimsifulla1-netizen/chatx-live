'use strict';
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL required');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw Error('JWT_SECRET must be at least 32 characters');
const db = new Pool({ connectionString: process.env.DATABASE_URL,
  // Render's internal PostgreSQL URL uses the private network (no TLS); external providers must configure TLS.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({ limit: '600kb' }));
app.use('/api/auth', rateLimit({windowMs: 15*60*1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false}));
app.use('/api/admin/login', rateLimit({windowMs: 15*60*1000, limit: 5, standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/messages', rateLimit({windowMs: 60*1000, limit: 80, standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/calls', rateLimit({windowMs: 60*1000, limit: 40, standardHeaders:'draft-7',legacyHeaders:false}));
app.use(express.static('public',{index:'index.html',maxAge:0}));

const query = (sql,params=[])=>db.query(sql,params);
const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(err=>{
  console.error('ChatX API error',err.code||err.message);
  res.status(500).json({error:'সার্ভারে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।'});
});
const validPhone = p=>typeof p==='string' && /^01[3-9]\d{8}$/.test(p);
const validName = n=>typeof n==='string' && /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(n);
const validPassword = p=>typeof p==='string' && p.length>=6 && p.length<=128;
const validPoint=p=>p && typeof p==='object' && Number.isFinite(p.lat) && Math.abs(p.lat)<=90 && Number.isFinite(p.lng) && Math.abs(p.lng)<=180 && Number.isFinite(p.accuracy) && p.accuracy>=0 && p.accuracy<=50000;
const userProjection='id,phone,username,chatx_id,avatar_data';
const signedUser=u=>jwt.sign({sub:u.id,typ:'user'},process.env.JWT_SECRET,{expiresIn:'30d',algorithm:'HS256',issuer:'chatx'});
async function auth(req,res,next){
  try{
    const t=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];
    const payload=jwt.verify(t,process.env.JWT_SECRET,{algorithms:['HS256'],issuer:'chatx'});
    if(payload.typ!=='user')throw Error('wrong token type');
    const {rows}=await query(`SELECT ${userProjection} FROM users WHERE id=$1`,[payload.sub]);
    if(!rows[0])return res.status(401).json({error:'সেশন শেষ। আবার লগইন করুন।'});
    req.user=rows[0]; next();
  }catch {res.status(401).json({error:'লগইন প্রয়োজন।'});}
}
function adminEnabled(){return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && process.env.ADMIN_SECOND_KEY && process.env.ADMIN_PASSWORD.length>=12 && process.env.ADMIN_SECOND_KEY.length>=12);}
function constantEqual(a,b){const ah=crypto.createHash('sha256').update(String(a||'')).digest(),bh=crypto.createHash('sha256').update(String(b||'')).digest();return crypto.timingSafeEqual(ah,bh);}
function adminAuth(req,res,next){try{
  const t=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];
  const p=jwt.verify(t,process.env.JWT_SECRET,{algorithms:['HS256'],issuer:'chatx-admin',audience:'admin'});
  if(p.typ!=='admin'||!adminEnabled())throw Error('invalid admin session');
  next();
}catch {res.status(401).json({error:'Admin login প্রয়োজন।'});}}

app.get('/api/health',wrap(async(req,res)=>{await query('SELECT 1');res.json({ok:true,version:'3.0.0'})}));
app.get('/api/settings',wrap(async(req,res)=>{const {rows}=await query('SELECT key,value FROM app_settings');res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])))}));

app.post('/api/auth/register',wrap(async(req,res)=>{
 const {phone,username,password}=req.body||{};
 if(!validPhone(phone))return res.status(400).json({field:'phone',error:'সঠিক ১১ সংখ্যার বাংলাদেশি নম্বর লিখুন।'});
 if(!validName(username))return res.status(400).json({field:'username',error:'Username ৩–২০ অক্ষর, প্রথম অক্ষর ইংরেজি হতে হবে।'});
 if(!validPassword(password))return res.status(400).json({field:'password',error:'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'});
 const id=crypto.randomUUID(),chatxId='CX-'+crypto.randomBytes(5).toString('hex').toUpperCase();
 const client=await db.connect();
 try{
   await client.query('BEGIN');
   const {rows}=await client.query(`INSERT INTO users(id,phone,username,password_hash,chatx_id) VALUES ($1,$2,$3,$4,$5) RETURNING ${userProjection}`,[id,phone,username.toLowerCase(),await bcrypt.hash(password,12),chatxId]);
   await client.query('COMMIT');res.status(201).json({token:signedUser(rows[0]),user:rows[0]});
 }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'এই মোবাইল নম্বর বা Username আগে ব্যবহৃত হয়েছে।'});throw e}
 finally{client.release()}
}));
app.post('/api/auth/login',wrap(async(req,res)=>{
 const {phone,password}=req.body||{};
 if(!validPhone(phone)||typeof password!=='string')return res.status(400).json({error:'মোবাইল নম্বর ও পাসওয়ার্ড ঠিকভাবে দিন।'});
 const {rows}=await query('SELECT * FROM users WHERE phone=$1',[phone]);const u=rows[0];
 if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'মোবাইল নম্বর বা পাসওয়ার্ড ভুল। আবার চেষ্টা করুন।'});
 const {password_hash,...user}=u;res.json({token:signedUser(user),user});
}));
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.post('/api/me/avatar',auth,wrap(async(req,res)=>{
 const data=req.body?.image;
 if(data!==null && (typeof data!=='string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data)))return res.status(400).json({error:'শুধু JPEG/PNG ছবি দেওয়া যাবে।'});
 if(data!==null && Buffer.byteLength(data,'utf8')>155000)return res.status(413).json({error:'ছবি বেশি বড়। ছোট ছবি ব্যবহার করুন।'});
 await query('UPDATE users SET avatar_data=$1 WHERE id=$2',[data||null,req.user.id]);
 res.json({ok:true,avatar_data:data||null});
}));
app.get('/api/users',auth,wrap(async(req,res)=>{
 const search=String(req.query.q||'').trim().slice(0,50);
 if(search.length<2)return res.json([]);
 const {rows}=await query('SELECT id,username,chatx_id,avatar_data FROM users WHERE id<>$1 AND (username ILIKE $2 OR chatx_id ILIKE $2) ORDER BY username LIMIT 20',[req.user.id,'%'+search+'%']);res.json(rows);
}));
app.post('/api/friends/request',auth,wrap(async(req,res)=>{
 const peer=String(req.body?.userId||'');
 if(peer===req.user.id)return res.status(400).json({error:'নিজেকে Add করা যাবে না।'});
 const user=await query('SELECT id FROM users WHERE id=$1',[peer]);if(!user.rowCount)return res.status(404).json({error:'ব্যবহারকারী পাওয়া যায়নি।'});
 const old=await query('SELECT 1 FROM friendships WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)',[req.user.id,peer]);if(old.rowCount)return res.status(409).json({error:'Friend Request আগেই আছে।'});
 await query('INSERT INTO friendships(sender_id,receiver_id) VALUES ($1,$2)',[req.user.id,peer]);res.status(201).json({ok:true});
}));
app.get('/api/friends',auth,wrap(async(req,res)=>{
 const {rows}=await query(`SELECT f.id,f.status,f.sender_id,f.receiver_id,u.id AS user_id,u.username,u.chatx_id,u.avatar_data FROM friendships f JOIN users u ON u.id=CASE WHEN f.sender_id=$1 THEN f.receiver_id ELSE f.sender_id END WHERE f.sender_id=$1 OR f.receiver_id=$1 ORDER BY f.created_at DESC`,[req.user.id]);res.json(rows);
}));
app.post('/api/friends/:id/accept',auth,wrap(async(req,res)=>{const r=await query("UPDATE friendships SET status='accepted' WHERE id=$1 AND receiver_id=$2 AND status='pending' RETURNING id",[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Pending request পাওয়া যায়নি।'});res.json({ok:true})}));
app.delete('/api/friends/:id',auth,wrap(async(req,res)=>{const r=await query('DELETE FROM friendships WHERE id=$1 AND (sender_id=$2 OR receiver_id=$2)',[req.params.id,req.user.id]);res.json({ok:r.rowCount>0})}));
async function areFriends(a,b){const r=await query("SELECT 1 FROM friendships WHERE status='accepted' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1))",[a,b]);return r.rowCount>0}
app.get('/api/messages/:peer',auth,wrap(async(req,res)=>{if(!await areFriends(req.user.id,req.params.peer))return res.status(403).json({error:'আগে Friend Add করুন।'});const {rows}=await query('SELECT id,sender_id,receiver_id,body,created_at FROM (SELECT * FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at ASC',[req.user.id,req.params.peer]);res.json(rows)}));
app.post('/api/messages',auth,wrap(async(req,res)=>{const peer=String(req.body?.userId||''),body=req.body?.body;if(typeof body!=='string'||!body.trim()||body.length>2000)return res.status(400).json({error:'মেসেজ ১–২০০০ অক্ষরের হতে হবে।'});if(!await areFriends(req.user.id,peer))return res.status(403).json({error:'আগে Friend Add করুন।'});const {rows}=await query('INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING id,sender_id,receiver_id,body,created_at',[req.user.id,peer,body.trim()]);res.status(201).json(rows[0])}));
app.get('/api/conversations',auth,wrap(async(req,res)=>{const {rows}=await query(`SELECT u.id,u.username,u.chatx_id,u.avatar_data,m.body,m.created_at FROM users u JOIN friendships f ON ((f.sender_id=$1 AND f.receiver_id=u.id) OR (f.receiver_id=$1 AND f.sender_id=u.id)) LEFT JOIN LATERAL (SELECT body,created_at FROM messages WHERE (sender_id=$1 AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=$1) ORDER BY created_at DESC LIMIT 1) m ON true WHERE f.status='accepted' ORDER BY m.created_at DESC NULLS LAST`,[req.user.id]);res.json(rows)}));

// Registration requires initial permission; subsequent live sharing is explicit, visible, one hour maximum.
app.get('/api/location/status',auth,wrap(async(req,res)=>{const {rows}=await query('SELECT active,sharing_until,updated_at FROM location_shares WHERE user_id=$1',[req.user.id]);const r=rows[0];res.json({active:Boolean(r?.active && new Date(r.sharing_until)>new Date()),sharing_until:r?.sharing_until||null,updated_at:r?.updated_at||null})}));
app.post('/api/location/start',auth,wrap(async(req,res)=>{if(req.body?.consent!==true)return res.status(400).json({error:'আপনার স্পষ্ট সম্মতি প্রয়োজন।'});const p=req.body?.location;if(!validPoint(p))return res.status(400).json({error:'অবস্থান পাওয়া যায়নি।'});await query(`INSERT INTO location_shares(user_id,lat,lng,accuracy,active,sharing_until,updated_at) VALUES ($1,$2,$3,$4,true,NOW()+INTERVAL '70 seconds',NOW()) ON CONFLICT(user_id) DO UPDATE SET lat=$2,lng=$3,accuracy=$4,active=true,sharing_until=NOW()+INTERVAL '70 seconds',updated_at=NOW()`,[req.user.id,p.lat,p.lng,p.accuracy]);res.json({ok:true,active:true,sharing_until:new Date(Date.now()+70000).toISOString()})}));
app.post('/api/location/update',auth,wrap(async(req,res)=>{const p=req.body?.location;if(!validPoint(p))return res.status(400).json({error:'লোকেশন সঠিক নয়।'});const r=await query('UPDATE location_shares SET lat=$1,lng=$2,accuracy=$3,updated_at=NOW(),sharing_until=NOW()+make_interval(secs=>70) WHERE user_id=$4 AND active=true AND sharing_until>NOW() RETURNING sharing_until',[p.lat,p.lng,p.accuracy,req.user.id]);if(!r.rowCount)return res.status(409).json({error:'লোকেশন শেয়ারিং বন্ধ বা মেয়াদ শেষ।'});res.json({ok:true})}));
app.post('/api/location/stop',auth,wrap(async(req,res)=>{await query('UPDATE location_shares SET active=false,lat=NULL,lng=NULL,accuracy=NULL WHERE user_id=$1',[req.user.id]);res.json({ok:true,active:false})}));

// WebRTC signaling. Actual microphone audio is peer-to-peer, not stored on this server.
// A TURN server may be required for calls between restrictive/mobile networks.
const validSDP=x=>x&&typeof x==='object'&&['offer','answer'].includes(x.type)&&typeof x.sdp==='string'&&x.sdp.length>20&&x.sdp.length<120000;
const isUUID=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
async function callAccess(callId,userId){
 if(!isUUID(callId))return null;
 const {rows}=await query('SELECT * FROM voice_calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)',[callId,userId]);return rows[0]||null;
}
app.post('/api/calls/start',auth,wrap(async(req,res)=>{
 const callee=String(req.body?.userId||''),offer=req.body?.offer;
 if(!isUUID(callee)||!validSDP(offer)||offer.type!=='offer')return res.status(400).json({error:'সঠিক কল তথ্য প্রয়োজন।'});
 if(!await areFriends(req.user.id,callee))return res.status(403).json({error:'বন্ধু ছাড়া কল করা যাবে না।'});
 const {rows}=await query("INSERT INTO voice_calls(id,caller_id,callee_id,status,offer_sdp) VALUES($1,$2,$3,'ringing',$4) RETURNING id,status",[crypto.randomUUID(),req.user.id,callee,JSON.stringify(offer)]);
 res.status(201).json(rows[0]);
}));
app.get('/api/calls/incoming',auth,wrap(async(req,res)=>{
 const {rows}=await query("SELECT c.id,c.caller_id,u.username,u.avatar_data,c.created_at FROM voice_calls c JOIN users u ON u.id=c.caller_id WHERE c.callee_id=$1 AND c.status='ringing' AND c.created_at>NOW()-INTERVAL '90 seconds' ORDER BY c.created_at DESC LIMIT 3",[req.user.id]);res.json(rows);
}));
app.get('/api/calls/:id',auth,wrap(async(req,res)=>{
 const c=await callAccess(req.params.id,req.user.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 res.json({id:c.id,status:c.status,caller_id:c.caller_id,callee_id:c.callee_id,offer:c.offer_sdp,answer:c.answer_sdp,created_at:c.created_at});
}));
app.post('/api/calls/:id/answer',auth,wrap(async(req,res)=>{
 const answer=req.body?.answer;if(!validSDP(answer)||answer.type!=='answer')return res.status(400).json({error:'সঠিক Answer প্রয়োজন।'});
 const {rows}=await query("UPDATE voice_calls SET status='accepted',answer_sdp=$1,updated_at=NOW() WHERE id=$2 AND callee_id=$3 AND status='ringing' AND created_at>NOW()-INTERVAL '90 seconds' RETURNING id",[JSON.stringify(answer),req.params.id,req.user.id]);
 if(!rows.length)return res.status(409).json({error:'কল শেষ হয়েছে বা মেয়াদ শেষ।'});res.json({ok:true});
}));
app.post('/api/calls/:id/ice',auth,wrap(async(req,res)=>{
 const c=await callAccess(req.params.id,req.user.id);if(!c||!['ringing','accepted'].includes(c.status))return res.status(404).json({error:'চলমান কল পাওয়া যায়নি।'});
 const candidate=req.body?.candidate;if(!candidate||typeof candidate!=='object'||JSON.stringify(candidate).length>9000)return res.status(400).json({error:'ICE candidate সঠিক নয়।'});
 await query('INSERT INTO voice_ice(call_id,user_id,candidate) VALUES($1,$2,$3)',[c.id,req.user.id,JSON.stringify(candidate)]);res.json({ok:true});
}));
app.get('/api/calls/:id/ice',auth,wrap(async(req,res)=>{
 const c=await callAccess(req.params.id,req.user.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 const after=Math.max(0,Number(req.query.after)||0);const {rows}=await query('SELECT id,candidate FROM voice_ice WHERE call_id=$1 AND user_id<>$2 AND id>$3 ORDER BY id LIMIT 100',[c.id,req.user.id,after]);res.json(rows);
}));
app.post('/api/calls/:id/end',auth,wrap(async(req,res)=>{
 const r=await query("UPDATE voice_calls SET status='ended',updated_at=NOW() WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) RETURNING id",[req.params.id,req.user.id]);res.json({ok:r.rowCount>0});
}));
// Separate password-protected admin (a 5-tap shortcut is only navigation, never authentication).
app.post('/api/admin/login',wrap(async(req,res)=>{
 if(!adminEnabled())return res.status(503).json({error:'Admin Panel চালু করতে Render-এ ADMIN_USERNAME, ADMIN_PASSWORD এবং ADMIN_SECOND_KEY দিন।'});
 const {username,password,secondKey}=req.body||{};
 if(!constantEqual(username,process.env.ADMIN_USERNAME)||!constantEqual(password,process.env.ADMIN_PASSWORD)||!constantEqual(secondKey,process.env.ADMIN_SECOND_KEY))return res.status(401).json({error:'Admin username, password অথবা second key সঠিক নয়।'});
 const token=jwt.sign({typ:'admin',sub:'owner'},process.env.JWT_SECRET,{expiresIn:'15m',issuer:'chatx-admin',audience:'admin',algorithm:'HS256'});
 res.json({token,expiresIn:900});
}));
app.get('/api/admin/summary',adminAuth,wrap(async(req,res)=>{const {rows}=await query(`SELECT (SELECT COUNT(*)::int FROM users) users,(SELECT COUNT(*)::int FROM friendships WHERE status='accepted') friendships,(SELECT COUNT(*)::int FROM messages) messages,(SELECT COUNT(*)::int FROM location_shares WHERE active=true AND sharing_until>NOW()) active_shares`);res.json(rows[0])}));
app.get('/api/admin/users',adminAuth,wrap(async(req,res)=>{const {rows}=await query('SELECT id,username,chatx_id,created_at FROM users ORDER BY created_at DESC LIMIT 60');res.json(rows)}));
app.get('/api/admin/locations',adminAuth,wrap(async(req,res)=>{const {rows}=await query(`SELECT u.username,u.chatx_id,s.lat,s.lng,s.accuracy,s.sharing_until,s.updated_at FROM location_shares s JOIN users u ON u.id=s.user_id WHERE s.active=true AND s.sharing_until>NOW() ORDER BY s.updated_at DESC LIMIT 100`);res.json(rows)}));
const allowedSettings={announcement:180,subtitle:120,accent:12,registrationNotice:350};
app.put('/api/admin/settings',adminAuth,wrap(async(req,res)=>{
 const patch=req.body?.settings;
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return res.status(400).json({error:'সঠিক সেটিং দিন।'});
 const entries=Object.entries(patch);
 if(!entries.length||entries.length>4||entries.some(([k,v])=>!(k in allowedSettings)||typeof v!=='string'||v.length>allowedSettings[k]||(k==='accent'&&!/^#[0-9a-fA-F]{6}$/.test(v))))return res.status(400).json({error:'অননুমোদিত সেটিং অথবা মান।'});
 for(const [k,v] of entries)await query('INSERT INTO app_settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',[k,v]);
 res.json({ok:true});
}));

const repo = process.env.GITHUB_REPOSITORY || 'sazimsifulla1-netizen/chatx-live';
// Never permit secret files such as .env; code editing is an explicit high-risk administrator action.
function editablePath(p){
 if(typeof p!=='string'||p.length>150||p.includes('..')||p.startsWith('/')||p.includes('\\'))return false;
 if(['server.js','package.json','README_BN.md','render.yaml','.github/workflows/android-apk.yml'].includes(p))return true;
 if(/^public\/[a-zA-Z0-9_./-]+\.(html|css|js|json)$/.test(p))return true;
 if(/^android\/[a-zA-Z0-9_./-]+\.(java|kt|kts|xml|properties)$/.test(p))return true;
 return false;
}
async function github(path,method='GET',payload){
 if(!process.env.GITHUB_EDIT_TOKEN)return {error:'GITHUB_EDIT_TOKEN is not configured',status:503};
 const url=`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
 const r=await fetch(url,{method,headers:{Authorization:`Bearer ${process.env.GITHUB_EDIT_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ChatX-Admin'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));return {status:r.status,data:d,error:r.ok?null:(d.message||'GitHub API failed')};
}
app.get('/api/admin/repo/list',adminAuth,wrap(async(req,res)=>{
 if(!process.env.GITHUB_EDIT_TOKEN)return res.status(503).json({error:'GITHUB_EDIT_TOKEN যোগ করুন।'});
 const r=await fetch(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`,{headers:{Authorization:`Bearer ${process.env.GITHUB_EDIT_TOKEN}`,'User-Agent':'ChatX-Admin',Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok)return res.status(r.status).json({error:d.message||'GitHub access failed'});
 res.json((d.tree||[]).filter(f=>f.type==='blob'&&editablePath(f.path)).map(f=>f.path));
}));
app.get('/api/admin/repo/file',adminAuth,wrap(async(req,res)=>{
 const path=String(req.query.path||'');if(!editablePath(path))return res.status(403).json({error:'এই ফাইল এডিটের অনুমতি নেই।'});
 const d=await github(path);if(d.error)return res.status(d.status).json({error:d.error});
 const buffer=Buffer.from((d.data.content||'').replace(/\s/g,''),'base64');
 if(buffer.length>350000)return res.status(413).json({error:'এই ফাইল অনেক বড়।'});
 res.json({path,sha:d.data.sha,content:buffer.toString('utf8')});
}));
app.put('/api/admin/repo/file',adminAuth,wrap(async(req,res)=>{
 const {path,content,sha,confirmPassword}=req.body||{};
 if(!editablePath(path)||typeof content!=='string'||Buffer.byteLength(content,'utf8')>300000||(sha!=null && (typeof sha!=='string'||sha.length>100)))return res.status(400).json({error:'ফাইলের তথ্য সঠিক নয়।'});
 if(!constantEqual(confirmPassword,process.env.ADMIN_PASSWORD))return res.status(403).json({error:'Commit করতে Admin password আবার দিন।'});
 const payload={message:`ChatX admin update: ${path}`,content:Buffer.from(content,'utf8').toString('base64'),branch:'main'};
 if(sha)payload.sha=sha;
 const d=await github(path,'PUT',payload);
 if(d.error)return res.status(d.status).json({error:d.error});
 res.json({ok:true,commit:d.data.commit?.sha,sha:d.data.content?.sha});
}));
app.get('/admin',(req,res)=>res.sendFile('admin.html',{root:'public'}));
app.use('/api',(req,res)=>res.status(404).json({error:'API পাওয়া যায়নি।'}));

async function start(){
 await query(`CREATE TABLE IF NOT EXISTS users(id UUID PRIMARY KEY,phone VARCHAR(11) UNIQUE NOT NULL,username VARCHAR(20) UNIQUE NOT NULL,password_hash TEXT NOT NULL,chatx_id VARCHAR(20) UNIQUE NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS friendships(id BIGSERIAL PRIMARY KEY,sender_id UUID NOT NULL REFERENCES users(id),receiver_id UUID NOT NULL REFERENCES users(id),status VARCHAR(10) NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(sender_id,receiver_id));
 CREATE TABLE IF NOT EXISTS messages(id BIGSERIAL PRIMARY KEY,sender_id UUID NOT NULL REFERENCES users(id),receiver_id UUID NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS msg_pair_idx ON messages(sender_id,receiver_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT;
 CREATE TABLE IF NOT EXISTS location_shares(user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,lat DOUBLE PRECISION,lng DOUBLE PRECISION,accuracy DOUBLE PRECISION,active BOOLEAN NOT NULL DEFAULT FALSE,sharing_until TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS voice_calls(id UUID PRIMARY KEY,caller_id UUID NOT NULL REFERENCES users(id),callee_id UUID NOT NULL REFERENCES users(id),status VARCHAR(12) NOT NULL,offer_sdp JSONB,answer_sdp JSONB,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS voice_ice(id BIGSERIAL PRIMARY KEY,call_id UUID NOT NULL REFERENCES voice_calls(id) ON DELETE CASCADE,user_id UUID NOT NULL REFERENCES users(id),candidate JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_voice_ice ON voice_ice(call_id,id);`);
 await query(`INSERT INTO app_settings(key,value) VALUES ('announcement','স্বাগতম ChatX Royal Purple-এ 💜'),('subtitle','আপনার বন্ধুদের আরও কাছে'),('accent','#8D42E8'),('registrationNotice','লোকেশন শেয়ার করা ঐচ্ছিক। অনুমতি দিলে কেবল অ্যাপ ব্যবহারের সময় অ্যাডমিন আপনার বর্তমান অবস্থান দেখতে পারবেন।') ON CONFLICT(key) DO NOTHING`);
 setInterval(()=>query("UPDATE location_shares SET active=false,lat=NULL,lng=NULL,accuracy=NULL WHERE active=true AND sharing_until<NOW()").catch(e=>console.error('location cleanup',e.message)),60000).unref();
 app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('ChatX v3 listening'));
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1)});
module.exports={app,validPhone,validName,validPassword,validPoint,editablePath,constantEqual};
