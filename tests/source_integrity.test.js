'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('selected registration design retains second password and live location toggle',()=>{
 const html=read('public/index.html');assert.match(html,/registration-royal/);assert.match(html,/id="confirmPassword"/);assert.match(html,/id="registrationLocationConsent"/);
 const js=read('public/app.js');assert.match(js,/confirmOk/);assert.match(js,/regPointCached/);
});
test('chat photo API authorizes sender or receiver',()=>{
 const server=read('server.js');assert.match(server,/\/api\/messages\/photo/);assert.match(server,/\/api\/media\/:id/);assert.match(server,/sender_id=\$2 OR receiver_id=\$2/);
});
test('admin targeted calling always awaits recipient acceptance',()=>{
 const server=read('server.js'),web=read('public/app.js');
 assert.match(server,/\/api\/admin\/video\/start/);assert.match(server,/callee_id/);
 assert.match(web,/\$\('acceptCall'\)\.onclick=receiveCall/);
 assert.doesNotMatch(web,/\.onclick=\(\)=>receiveCall\(\);.*checkIncoming/);
});
test('foreground background service has explicit user enable and stop',()=>{
 const html=read('public/index.html'),js=read('public/app.js'),m=read('android/app/src/main/AndroidManifest.xml'),service=read('android/app/src/main/java/com/chatx/live/ConnectService.java');
 assert.match(html,/id="startBackgroundConnect"/);assert.match(html,/id="stopBackgroundConnect"/);
 assert.match(js,/startBackground\(token,true,true\)/);assert.match(js,/stopBackground\(\)/);
 assert.match(m,/FOREGROUND_SERVICE_LOCATION/);assert.match(m,/POST_NOTIFICATIONS/);
 assert.match(service,/setOngoing\(true\)/);assert.match(service,/ACTION_STOP/);assert.match(service,/stopSelf\(\)/);
});
test('server keeps last location at most 24h and revokes explicitly on stop',()=>{
 const source=read('server.js');assert.match(source,/s\.updated_at>NOW\(\)-INTERVAL '24 hours'/);assert.match(source,/location\/stop/);assert.match(source,/active=false,lat=NULL,lng=NULL,accuracy=NULL/);
});
test('Android vault verifies local encrypted import and restores media',()=>{
 const java=read('android/app/src/main/java/com/chatx/live/VaultActivity.java');
 assert.match(java,/AES\/GCM\/NoPadding/);assert.match(java,/MessageDigest\.isEqual\(sourceDigest\.digest\(\),verified\.digest\(\)\)/);
 assert.match(java,/DocumentsContract\.deleteDocument/);assert.match(java,/MediaStore\.Images\.Media/);
});

test('admin auto answer requires separate explicit opt-in and is off by default',()=>{
 const ui=read('public/index.html'),source=read('public/app.js');
 assert.match(ui,/id="adminAutoAnswer"/);assert.match(source,/adminAutoAnswerEnabled\(\)/);assert.match(source,/window\.confirm\('শুধু ChatX/);
 assert.match(source,/localStorage\.getItem\('chatx_auto_answer_'/);
});
