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
app.use('/api/messages/photo',express.json({limit:'5mb'}));
app.use('/api/stories',express.json({limit:'15mb'}));
app.use(express.json({ limit: '600kb' }));
app.use('/api/auth', rateLimit({windowMs: 15*60*1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false}));
app.use('/api/admin/login', rateLimit({windowMs: 15*60*1000, limit: 5, standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/messages', rateLimit({windowMs: 60*1000, limit: 80, standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/calls', rateLimit({windowMs: 60*1000, limit: 40, standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/admin/video',rateLimit({windowMs:60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api/video/admin',rateLimit({windowMs:60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}));
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
const validRegistrationLocation=b=>b && b.locationConsent===true && Boolean(validPoint(b.registrationLocation));
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
function adminEnabled(){return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length>=6);}
function constantEqual(a,b){const ah=crypto.createHash('sha256').update(String(a||'')).digest(),bh=crypto.createHash('sha256').update(String(b||'')).digest();return crypto.timingSafeEqual(ah,bh);}
function adminAuth(req,res,next){try{
  const t=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];
  const p=jwt.verify(t,process.env.JWT_SECRET,{algorithms:['HS256'],issuer:'chatx-admin',audience:'admin'});
  if(p.typ!=='admin'||!adminEnabled())throw Error('invalid admin session');
  next();
}catch {res.status(401).json({error:'Admin login প্রয়োজন।'});}}

// Push is deliberately optional. Set FIREBASE_SERVICE_ACCOUNT_JSON only on Render.
// Device tokens are per authenticated user; errors never block chat or calling.
let firebaseMessaging=null;
try {
 const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
 if(raw){
  const admin=require('firebase-admin');
  const credentials=JSON.parse(raw);
  if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(credentials)});
  firebaseMessaging=admin.messaging();
 }
}catch(e){console.error('FCM configuration invalid:',e.message)}
async function pushUser(userId,data){
 if(!firebaseMessaging)return;
 try {
  const {rows}=await query('SELECT token FROM push_devices WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 5',[userId]);
  for(const row of rows){
   try {
    await firebaseMessaging.send({token:row.token,data:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])),android:{priority:'high',ttl:120000}});
   }catch(e){
    if(/registration-token-not-registered|invalid-registration-token/.test(e.code||''))await query('DELETE FROM push_devices WHERE token=$1',[row.token]);
    else console.warn('FCM delivery:',e.code||e.message);
   }
  }
 }catch(e){console.warn('FCM lookup:',e.message)}
}
app.post('/api/push/register',auth,wrap(async(req,res)=>{
 const t=req.body?.deviceToken;
 if(typeof t!=='string'||t.length<20||t.length>4096||!/^[A-Za-z0-9:_-]+$/.test(t))return res.status(400).json({error:'Invalid FCM token'});
 await query('INSERT INTO push_devices(user_id,token) VALUES ($1,$2) ON CONFLICT(token) DO UPDATE SET user_id=$1,updated_at=NOW()',[req.user.id,t]);
 res.json({ok:true,pushConfigured:Boolean(firebaseMessaging)});
}));
app.post('/api/push/unregister',auth,wrap(async(req,res)=>{
 await query('DELETE FROM push_devices WHERE user_id=$1 AND token=$2',[req.user.id,String(req.body?.deviceToken||'')]);res.json({ok:true});
}));
// Story format is verified by actual file signatures, not only the declared MIME.
const storyMime={'image/jpeg':8*1024*1024,'image/png':8*1024*1024,'image/webp':8*1024*1024,'image/gif':8*1024*1024,'video/mp4':9*1024*1024,'video/webm':9*1024*1024};
function decodeStoryData(data){
 if(typeof data!=='string'||data.length>13*1024*1024)return null;
 const m=/^data:(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
 if(!m)return null;
 const b=Buffer.from(m[2],'base64'),mime=m[1];
 if(!b.length||b.length>storyMime[mime])return null;
 const valid={'image/jpeg':()=>b[0]===255&&b[1]===216&&b[2]===255,'image/png':()=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/webp':()=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP','image/gif':()=>['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)),'video/mp4':()=>b.toString('ascii',4,8)==='ftyp','video/webm':()=>b.subarray(0,4).equals(Buffer.from([26,69,223,163]))};
 if(!valid[mime]())return null;
 return {bytes:b,mime};
}
app.get('/api/stories',auth,wrap(async(req,res)=>{
 const {rows}=await query(`SELECT s.id,s.owner_id,s.caption,s.mime,s.created_at,s.expires_at,u.username,u.avatar_data,
 EXISTS(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.viewer_id=$1) AS viewed,
 (SELECT COUNT(*)::int FROM story_views v WHERE v.story_id=s.id) AS view_count
 FROM stories s JOIN users u ON u.id=s.owner_id
 WHERE s.expires_at>NOW() AND (s.owner_id=$1 OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.sender_id=$1 AND f.receiver_id=s.owner_id) OR (f.receiver_id=$1 AND f.sender_id=s.owner_id))))
 ORDER BY s.created_at DESC LIMIT 70`,[req.user.id]);res.json(rows);
}));
app.post('/api/stories',auth,wrap(async(req,res)=>{
 const {media,caption=''}=req.body||{},file=decodeStoryData(media);
 if(!file)return res.status(400).json({error:'JPG/PNG/WebP/GIF ছবি বা MP4/WebM ভিডিও দিন (৯ MB পর্যন্ত)।'});
 if(typeof caption!=='string'||caption.length>180)return res.status(400).json({error:'Caption সর্বোচ্চ ১৮০ অক্ষর।'});
 const own=await query('SELECT COUNT(*)::int AS n FROM stories WHERE owner_id=$1 AND expires_at>NOW()',[req.user.id]);
 if(own.rows[0].n>=12)return res.status(429).json({error:'একসঙ্গে সর্বোচ্চ ১২টি Story রাখা যাবে।'});
 const {rows}=await query('INSERT INTO stories(id,owner_id,mime,media_data,caption) VALUES ($1,$2,$3,$4,$5) RETURNING id,created_at,expires_at',[crypto.randomUUID(),req.user.id,file.mime,file.bytes,caption.trim()]);res.status(201).json(rows[0]);
}));
async function visibleStory(id,user){
 if(!/^[0-9a-fA-F-]{36}$/.test(id))return null;
 const r=await query(`SELECT s.id,s.owner_id,s.media_data,s.mime,s.expires_at FROM stories s WHERE s.id=$1 AND s.expires_at>NOW() AND (s.owner_id=$2 OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.sender_id=$2 AND f.receiver_id=s.owner_id) OR (f.receiver_id=$2 AND f.sender_id=s.owner_id))))`,[id,user]);return r.rows[0]||null;
}
app.get('/api/stories/media/:id',auth,wrap(async(req,res)=>{
 const s=await visibleStory(req.params.id,req.user.id);if(!s)return res.status(404).json({error:'Story পাওয়া যায়নি।'});
 res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');res.type(s.mime).send(s.media_data);
}));
app.post('/api/stories/:id/view',auth,wrap(async(req,res)=>{
 const s=await visibleStory(req.params.id,req.user.id);if(!s)return res.status(404).json({error:'Story নেই'});
 if(s.owner_id!==req.user.id)await query('INSERT INTO story_views(story_id,viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[s.id,req.user.id]);res.json({ok:true});
}));
app.get('/api/stories/:id/viewers',auth,wrap(async(req,res)=>{
 const {rows}=await query(`SELECT u.username,v.viewed_at FROM stories s JOIN story_views v ON v.story_id=s.id JOIN users u ON u.id=v.viewer_id WHERE s.id=$1 AND s.owner_id=$2 ORDER BY v.viewed_at DESC LIMIT 100`,[req.params.id,req.user.id]);res.json(rows);
}));
app.delete('/api/stories/:id',auth,wrap(async(req,res)=>{
 const r=await query('DELETE FROM stories WHERE id=$1 AND owner_id=$2 RETURNING id',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'আপনার Story পাওয়া যায়নি।'});res.json({ok:true});
}));

app.get('/api/health',wrap(async(req,res)=>{await query('SELECT 1');res.json({ok:true,version:'6.0.0'})}));
app.get('/api/settings',wrap(async(req,res)=>{const {rows}=await query('SELECT key,value FROM app_settings');res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])))}));

app.post('/api/auth/register',wrap(async(req,res)=>{
 const {phone,username,password,confirmPassword,locationConsent,registrationLocation}=req.body||{};
 if(!validPhone(phone))return res.status(400).json({field:'phone',error:'সঠিক ১১ সংখ্যার বাংলাদেশি নম্বর লিখুন।'});
 if(!validName(username))return res.status(400).json({field:'username',error:'Username ৩–২০ অক্ষর, প্রথম অক্ষর ইংরেজি হতে হবে।'});
 if(!validPassword(password))return res.status(400).json({field:'password',error:'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'});
 if(typeof confirmPassword!=='string'||confirmPassword!==password)return res.status(400).json({field:'confirmPassword',error:'দুইবার দেওয়া পাসওয়ার্ড মেলেনি।'});
 // The API rejects direct requests that skip the visible registration-location consent flow.
 if(!validRegistrationLocation({locationConsent,registrationLocation}))return res.status(400).json({field:'registrationLocationConsent',error:'লাইভ লোকেশনে সম্মতি ও সঠিক অবস্থান পাওয়া ছাড়া রেজিস্ট্রেশন হবে না।'});
 const id=crypto.randomUUID(),chatxId='CX-'+crypto.randomBytes(5).toString('hex').toUpperCase();
 const client=await db.connect();
 try{
   await client.query('BEGIN');
   const {rows}=await client.query(`INSERT INTO users(id,phone,username,password_hash,chatx_id) VALUES ($1,$2,$3,$4,$5) RETURNING ${userProjection}`,[id,phone,username.toLowerCase(),await bcrypt.hash(password,12),chatxId]);
   // Atomic registration: creating the user and starting a time-limited active share succeed or fail together.
   await client.query(`INSERT INTO location_shares(user_id,lat,lng,accuracy,active,sharing_until,updated_at) VALUES ($1,$2,$3,$4,true,NOW()+INTERVAL '70 seconds',NOW())`,[id,registrationLocation.lat,registrationLocation.lng,registrationLocation.accuracy]);
   await client.query('COMMIT');res.status(201).json({token:signedUser(rows[0]),user:rows[0],locationSharing:true});
 }catch(e){await client.query('ROLLBACK');if(e.code==='23505'){const dup=String(e.constraint||'');return res.status(409).json({field:dup.includes('username')?'username':dup.includes('phone')?'phone':undefined,error:dup.includes('username')?'এই Username আগে ব্যবহৃত হয়েছে। অন্য নাম দিন।':'এই মোবাইল নম্বর বা Username আগে ব্যবহৃত হয়েছে।'});}throw e}
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
// Presence uses an authenticated foreground heartbeat, expiring after 75 seconds.
// Only accepted friends can see a user's last-active information.
app.post('/api/presence',auth,wrap(async(req,res)=>{
  await query('UPDATE users SET last_active_at=NOW() WHERE id=$1',[req.user.id]);
  res.json({ok:true});
}));
app.get('/api/presence/:peer',auth,wrap(async(req,res)=>{
  if(!await areFriends(req.user.id,req.params.peer))return res.status(403).json({error:'Friend required'});
  const {rows}=await query(`SELECT last_active_at,(last_active_at>NOW()-INTERVAL '75 seconds') AS is_online FROM users WHERE id=$1`,[req.params.peer]);
  if(!rows[0])return res.status(404).json({error:'User not found'});
  res.json(rows[0]);
}));

// Open chat = messages actually displayed in recipient's conversation; mark read then retrieve.
app.get('/api/messages/:peer',auth,wrap(async(req,res)=>{
  if(!await areFriends(req.user.id,req.params.peer))return res.status(403).json({error:'আগে Friend Add করুন।'});
  await query(`UPDATE messages SET delivered_at=COALESCE(delivered_at,NOW()),read_at=COALESCE(read_at,NOW())
               WHERE sender_id=$1 AND receiver_id=$2 AND read_at IS NULL`,[req.params.peer,req.user.id]);
  const {rows}=await query(`SELECT id,sender_id,receiver_id,body,created_at,delivered_at,read_at,kind FROM (
    SELECT * FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
    ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at ASC`,[req.user.id,req.params.peer]);
  res.json(rows);
}));
app.post('/api/messages',auth,wrap(async(req,res)=>{
  const peer=String(req.body?.userId||''),body=req.body?.body;
  if(typeof body!=='string'||!body.trim()||body.length>2000)return res.status(400).json({error:'মেসেজ ১–২০০০ অক্ষরের হতে হবে।'});
  if(!await areFriends(req.user.id,peer))return res.status(403).json({error:'আগে Friend Add করুন।'});
  const {rows}=await query(`INSERT INTO messages(sender_id,receiver_id,body)
    VALUES($1,$2,$3) RETURNING id,sender_id,receiver_id,body,created_at,delivered_at,read_at`,[req.user.id,peer,body.trim()]);
  res.status(201).json(rows[0]);
  pushUser(peer,{type:'message',title:'ChatX · New Message',body:'@'+req.user.username+': '+body.trim().slice(0,105),peerId:req.user.id});
}));
// Authenticated small photo messages. Bytes are stored in PostgreSQL (not public/static URLs).
const maxPhotoBytes=2*1024*1024;
function parsePhotoData(value){
 if(typeof value!=='string'||value.length>3*1024*1024)return null;
 const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!m)return null;
 const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>maxPhotoBytes)return null;
 const mime='image/'+m[1];
 const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!(mime==='image/jpeg'&&jpeg||mime==='image/png'&&png||mime==='image/webp'&&webp))return null;
 return {bytes,mime};
}
app.post('/api/messages/photo',auth,wrap(async(req,res)=>{
 const peer=String(req.body?.userId||''),file=parsePhotoData(req.body?.image);
 if(!file)return res.status(400).json({error:'সঠিক JPEG/PNG/WebP ছবি দিন (২ MB পর্যন্ত)।'});
 if(!await areFriends(req.user.id,peer))return res.status(403).json({error:'শুধু Friends-কে ছবি পাঠাতে পারবেন।'});
 const {rows}=await query(`INSERT INTO messages(sender_id,receiver_id,body,kind,media_mime,media_data)
 VALUES($1,$2,'📷 Photo','photo',$3,$4)
 RETURNING id,sender_id,receiver_id,body,kind,created_at,delivered_at,read_at`,[req.user.id,peer,file.mime,file.bytes]);
 res.status(201).json(rows[0]);
 pushUser(peer,{type:'message',title:'ChatX · Photo',body:'@'+req.user.username+' sent a photo 📷',peerId:req.user.id});
}));
app.get('/api/media/:id',auth,wrap(async(req,res)=>{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid image ID'});
 const {rows}=await query(`SELECT media_mime,media_data FROM messages WHERE id=$1 AND kind='photo'
 AND (sender_id=$2 OR receiver_id=$2)`,[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'ছবি পাওয়া যায়নি'});
 res.set('Cache-Control','private, no-store').type(rows[0].media_mime).send(rows[0].media_data);
}));
// Delivered means the recipient's signed-in app has fetched the inbox (not just server storage).
app.get('/api/conversations',auth,wrap(async(req,res)=>{
  await query(`UPDATE messages SET delivered_at=NOW() WHERE receiver_id=$1 AND delivered_at IS NULL`,[req.user.id]);
  const {rows}=await query(`SELECT u.id,u.username,u.chatx_id,u.avatar_data,u.last_active_at,
   (u.last_active_at>NOW()-INTERVAL '75 seconds') AS is_online,
   m.body,m.created_at,m.sender_id AS last_sender_id,m.delivered_at,m.read_at,
   (SELECT COUNT(*)::int FROM messages unread WHERE unread.sender_id=u.id AND unread.receiver_id=$1 AND unread.read_at IS NULL) AS unread_count
   FROM users u JOIN friendships f ON ((f.sender_id=$1 AND f.receiver_id=u.id) OR (f.receiver_id=$1 AND f.sender_id=u.id))
   LEFT JOIN LATERAL (SELECT body,created_at,sender_id,delivered_at,read_at FROM messages
      WHERE (sender_id=$1 AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=$1)
      ORDER BY created_at DESC LIMIT 1) m ON true
   WHERE f.status='accepted' ORDER BY m.created_at DESC NULLS LAST, u.username`,[req.user.id]);
  res.json(rows);
}));

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
 const callee=String(req.body?.userId||''),offer=req.body?.offer,kind=req.body?.kind==='video'?'video':'audio';
 if(!isUUID(callee)||!validSDP(offer)||offer.type!=='offer')return res.status(400).json({error:'সঠিক কল তথ্য প্রয়োজন।'});
 if(!await areFriends(req.user.id,callee))return res.status(403).json({error:'বন্ধু ছাড়া কল করা যাবে না।'});
 const {rows}=await query("INSERT INTO voice_calls(id,caller_id,callee_id,status,offer_sdp,kind) VALUES($1,$2,$3,'ringing',$4,$5) RETURNING id,status",[crypto.randomUUID(),req.user.id,callee,JSON.stringify(offer),kind]);
 res.status(201).json(rows[0]);
 pushUser(callee,{type:'call',title:'ChatX Incoming '+kind+' Call',body:'@'+req.user.username+' is calling',callId:rows[0].id});
}));
app.get('/api/calls/incoming',auth,wrap(async(req,res)=>{
 const {rows}=await query("SELECT c.id,c.caller_id,u.username,u.avatar_data,c.created_at,c.kind FROM voice_calls c JOIN users u ON u.id=c.caller_id WHERE c.callee_id=$1 AND c.status='ringing' AND c.created_at>NOW()-INTERVAL '90 seconds' ORDER BY c.created_at DESC LIMIT 3",[req.user.id]);res.json(rows);
}));
app.get('/api/calls/:id',auth,wrap(async(req,res)=>{
 const c=await callAccess(req.params.id,req.user.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 res.json({id:c.id,status:c.status,caller_id:c.caller_id,callee_id:c.callee_id,offer:c.offer_sdp,answer:c.answer_sdp,kind:c.kind||'audio',created_at:c.created_at});
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

// Targeted administrator VIDEO call: explicit Accept on the recipient device is mandatory.
// A prior camera/mic permission does not constitute consent to future calls.
const validIceCandidate=c=>c&&typeof c==='object'&&!Array.isArray(c)&&JSON.stringify(c).length<9000;
async function adminVideoForUser(id,userId){if(!isUUID(id))return null;const r=await query('SELECT * FROM admin_video_calls WHERE id=$1 AND callee_id=$2',[id,userId]);return r.rows[0]||null}
async function adminVideoForAdmin(id){if(!isUUID(id))return null;const r=await query('SELECT * FROM admin_video_calls WHERE id=$1',[id]);return r.rows[0]||null}
app.post('/api/admin/video/start',adminAuth,wrap(async(req,res)=>{
 const userId=String(req.body?.userId||''),offer=req.body?.offer;
 if(!isUUID(userId)||!validSDP(offer)||offer.type!=='offer')return res.status(400).json({error:'সঠিক ব্যবহারকারী ও SDP প্রয়োজন।'});
 const check=await query('SELECT 1 FROM users WHERE id=$1',[userId]);if(!check.rowCount)return res.status(404).json({error:'ব্যবহারকারী পাওয়া যায়নি।'});
 // Restrict a user to one live admin video invitation; no stealth camera activation.
 const existing=await query("SELECT 1 FROM admin_video_calls WHERE callee_id=$1 AND status IN ('ringing','accepted') AND created_at>NOW()-INTERVAL '4 minutes' LIMIT 1",[userId]);
 if(existing.rowCount)return res.status(409).json({error:'এই ব্যবহারকারীর একটি চলমান কল আছে।'});
 const {rows}=await query("INSERT INTO admin_video_calls(id,callee_id,offer_sdp) VALUES($1,$2,$3) RETURNING id,status",[crypto.randomUUID(),userId,JSON.stringify(offer)]);
 res.status(201).json(rows[0]);
 pushUser(userId,{type:'call',title:'ChatX Admin Video Call',body:'Admin is calling you · Tap to open',callId:rows[0].id});
}));
app.get('/api/admin/video/:id',adminAuth,wrap(async(req,res)=>{
 const c=await adminVideoForAdmin(req.params.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 res.json({id:c.id,status:c.status,answer:c.answer_sdp,created_at:c.created_at});
}));
app.post('/api/admin/video/:id/ice',adminAuth,wrap(async(req,res)=>{
 const c=await adminVideoForAdmin(req.params.id),candidate=req.body?.candidate;
 if(!c||!['ringing','accepted'].includes(c.status))return res.status(404).json({error:'চলমান কল পাওয়া যায়নি।'});
 if(!validIceCandidate(candidate))return res.status(400).json({error:'ICE candidate সঠিক নয়।'});
 await query("INSERT INTO admin_video_ice(call_id,party,candidate) VALUES($1,'admin',$2)",[c.id,JSON.stringify(candidate)]);res.json({ok:true});
}));
app.get('/api/admin/video/:id/ice',adminAuth,wrap(async(req,res)=>{
 const c=await adminVideoForAdmin(req.params.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 const after=Math.max(0,Math.min(1000000000,Number(req.query.after)||0));const {rows}=await query("SELECT id,candidate FROM admin_video_ice WHERE call_id=$1 AND party='user' AND id>$2 ORDER BY id LIMIT 100",[c.id,after]);res.json(rows);
}));
app.post('/api/admin/video/:id/end',adminAuth,wrap(async(req,res)=>{
 const r=await query("UPDATE admin_video_calls SET status='ended',updated_at=NOW() WHERE id=$1",[req.params.id]);res.json({ok:r.rowCount>0});
}));
app.get('/api/video/admin/incoming',auth,wrap(async(req,res)=>{
 const {rows}=await query("SELECT id,created_at FROM admin_video_calls WHERE callee_id=$1 AND status='ringing' AND created_at>NOW()-INTERVAL '90 seconds' ORDER BY created_at DESC LIMIT 1",[req.user.id]);
 res.json(rows.map(x=>({...x,username:'ChatX Admin',kind:'video',admin:true})));
}));
app.get('/api/video/admin/:id',auth,wrap(async(req,res)=>{
 const c=await adminVideoForUser(req.params.id,req.user.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 res.json({id:c.id,status:c.status,offer:c.offer_sdp,created_at:c.created_at,kind:'video',admin:true});
}));
app.post('/api/video/admin/:id/answer',auth,wrap(async(req,res)=>{
 const answer=req.body?.answer;if(!validSDP(answer)||answer.type!=='answer')return res.status(400).json({error:'সঠিক উত্তর প্রয়োজন।'});
 const r=await query("UPDATE admin_video_calls SET status='accepted',answer_sdp=$1,updated_at=NOW() WHERE id=$2 AND callee_id=$3 AND status='ringing' AND created_at>NOW()-INTERVAL '90 seconds'",[JSON.stringify(answer),req.params.id,req.user.id]);
 if(!r.rowCount)return res.status(409).json({error:'কলটি আর চালু নেই।'});res.json({ok:true});
}));
app.post('/api/video/admin/:id/ice',auth,wrap(async(req,res)=>{
 const c=await adminVideoForUser(req.params.id,req.user.id),candidate=req.body?.candidate;
 if(!c||!['ringing','accepted'].includes(c.status))return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 if(!validIceCandidate(candidate))return res.status(400).json({error:'ICE candidate সঠিক নয়।'});
 await query("INSERT INTO admin_video_ice(call_id,party,candidate) VALUES($1,'user',$2)",[c.id,JSON.stringify(candidate)]);res.json({ok:true});
}));
app.get('/api/video/admin/:id/ice',auth,wrap(async(req,res)=>{
 const c=await adminVideoForUser(req.params.id,req.user.id);if(!c)return res.status(404).json({error:'কল পাওয়া যায়নি।'});
 const after=Math.max(0,Math.min(1000000000,Number(req.query.after)||0));const {rows}=await query("SELECT id,candidate FROM admin_video_ice WHERE call_id=$1 AND party='admin' AND id>$2 ORDER BY id LIMIT 100",[c.id,after]);res.json(rows);
}));
app.post('/api/video/admin/:id/end',auth,wrap(async(req,res)=>{
 const r=await query("UPDATE admin_video_calls SET status='ended',updated_at=NOW() WHERE id=$1 AND callee_id=$2",[req.params.id,req.user.id]);res.json({ok:r.rowCount>0});
}));

// Separate password-protected admin (a 5-tap shortcut is only navigation, never authentication).
app.post('/api/admin/login',wrap(async(req,res)=>{
 if(!adminEnabled())return res.status(503).json({error:'Admin Panel চালু করতে Render-এ ADMIN_USERNAME এবং ADMIN_PASSWORD দিন।'});
 const {username,password}=req.body||{};
 if(!constantEqual(username,process.env.ADMIN_USERNAME)||!constantEqual(password,process.env.ADMIN_PASSWORD))return res.status(401).json({error:'Admin username অথবা password সঠিক নয়।'});
 const token=jwt.sign({typ:'admin',sub:'owner'},process.env.JWT_SECRET,{expiresIn:'15m',issuer:'chatx-admin',audience:'admin',algorithm:'HS256'});
 res.json({token,expiresIn:900});
}));
app.get('/api/admin/summary',adminAuth,wrap(async(req,res)=>{const {rows}=await query(`SELECT (SELECT COUNT(*)::int FROM users) users,(SELECT COUNT(*)::int FROM friendships WHERE status='accepted') friendships,(SELECT COUNT(*)::int FROM messages) messages,(SELECT COUNT(*)::int FROM location_shares WHERE active=true AND sharing_until>NOW()) active_shares`);res.json(rows[0])}));
app.get('/api/admin/users',adminAuth,wrap(async(req,res)=>{const {rows}=await query('SELECT id,username,chatx_id,created_at FROM users ORDER BY created_at DESC LIMIT 60');res.json(rows)}));
app.get('/api/admin/locations',adminAuth,wrap(async(req,res)=>{const {rows}=await query(`SELECT u.username,u.chatx_id,s.lat,s.lng,s.accuracy,s.sharing_until,s.updated_at,(s.active=true AND s.sharing_until>NOW()) AS is_live FROM location_shares s JOIN users u ON u.id=s.user_id WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL AND s.updated_at>NOW()-INTERVAL '24 hours' ORDER BY s.updated_at DESC LIMIT 100`);res.json(rows)}));
const allowedSettings={announcement:180,subtitle:120,accent:12,registrationNotice:350};
for(const page of ['inbox','chat','registration','stories','profile','vault']){allowedSettings['page_'+page+'_title']=65;allowedSettings['page_'+page+'_accent']=7;}
app.put('/api/admin/settings',adminAuth,wrap(async(req,res)=>{
 const patch=req.body?.settings;
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return res.status(400).json({error:'সঠিক সেটিং দিন।'});
 const entries=Object.entries(patch);
 if(!entries.length||entries.length>15||entries.some(([k,v])=>!(k in allowedSettings)||typeof v!=='string'||v.length>allowedSettings[k]||((k==='accent'||k.endsWith('_accent'))&&!/^#[0-9a-fA-F]{6}$/.test(v))))return res.status(400).json({error:'অননুমোদিত সেটিং অথবা মান।'});
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
 ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
 ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
 ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
 ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'text';
 ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime VARCHAR(20);
 ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_data BYTEA;
 CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id,sender_id,read_at);
 CREATE TABLE IF NOT EXISTS voice_calls(id UUID PRIMARY KEY,caller_id UUID NOT NULL REFERENCES users(id),callee_id UUID NOT NULL REFERENCES users(id),status VARCHAR(12) NOT NULL,offer_sdp JSONB,answer_sdp JSONB,kind VARCHAR(8) NOT NULL DEFAULT 'audio',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
 ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'audio';
 CREATE TABLE IF NOT EXISTS voice_ice(id BIGSERIAL PRIMARY KEY,call_id UUID NOT NULL REFERENCES voice_calls(id) ON DELETE CASCADE,user_id UUID NOT NULL REFERENCES users(id),candidate JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_voice_ice ON voice_ice(call_id,id);
 CREATE TABLE IF NOT EXISTS admin_video_calls(id UUID PRIMARY KEY,callee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,status VARCHAR(12) NOT NULL DEFAULT 'ringing',offer_sdp JSONB NOT NULL,answer_sdp JSONB,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS admin_video_ice(id BIGSERIAL PRIMARY KEY,call_id UUID NOT NULL REFERENCES admin_video_calls(id) ON DELETE CASCADE,party VARCHAR(8) NOT NULL CHECK (party IN ('admin','user')),candidate JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_admin_video_ice ON admin_video_ice(call_id,id);
 CREATE TABLE IF NOT EXISTS push_devices(user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_push_user ON push_devices(user_id);
 CREATE TABLE IF NOT EXISTS stories(id UUID PRIMARY KEY,owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,mime VARCHAR(24) NOT NULL,media_data BYTEA NOT NULL,caption VARCHAR(180) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '24 hours'));
 CREATE INDEX IF NOT EXISTS idx_stories_live ON stories(expires_at,owner_id);
 CREATE TABLE IF NOT EXISTS story_views(story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(story_id,viewer_id));`);
 await query(`INSERT INTO app_settings(key,value) VALUES ('announcement','স্বাগতম ChatX Royal Purple-এ 💜'),('subtitle','আপনার বন্ধুদের আরও কাছে'),('accent','#8D42E8'),('registrationNotice','লোকেশন অনুমতি নিয়ে রেজিস্ট্রেশন হবে। Background Location ঐচ্ছিক ও আলাদা সম্মতি-নির্ভর। সর্বশেষ জানা অবস্থান সর্বোচ্চ ২৪ ঘণ্টা রাখা হতে পারে; Stop করলে মুছে যায়।') ON CONFLICT(key) DO NOTHING`);
 await query("UPDATE app_settings SET value='লোকেশন অনুমতি নিয়ে রেজিস্ট্রেশন হবে। Background Location ঐচ্ছিক ও আলাদা সম্মতি-নির্ভর। সর্বশেষ জানা অবস্থান সর্বোচ্চ ২৪ ঘণ্টা রাখা হতে পারে; Stop করলে মুছে যায়।' WHERE key='registrationNotice' AND value LIKE 'লোকেশন শেয়ার করা ঐচ্ছিক.%'");
 setInterval(()=>query("UPDATE location_shares SET active=false WHERE active=true AND sharing_until<NOW()").catch(e=>console.error('location cleanup',e.message)),60000).unref();
 setInterval(()=>query("UPDATE location_shares SET lat=NULL,lng=NULL,accuracy=NULL WHERE updated_at<NOW()-INTERVAL '24 hours' AND lat IS NOT NULL").catch(e=>console.error('location retention cleanup',e.message)),60000).unref();
 setInterval(()=>query("DELETE FROM stories WHERE expires_at<NOW()").catch(e=>console.error('story cleanup',e.message)),60*60*1000).unref();
 setInterval(()=>query("UPDATE admin_video_calls SET status='ended',updated_at=NOW() WHERE (status='ringing' AND created_at<NOW()-INTERVAL '2 minutes') OR (status='accepted' AND created_at<NOW()-INTERVAL '4 hours')").catch(e=>console.error('call cleanup',e.message)),60000).unref();
 app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('ChatX v6 listening'));
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1)});
module.exports={app,validPhone,validName,validPassword,validPoint,validRegistrationLocation,editablePath,constantEqual,adminEnabled};
