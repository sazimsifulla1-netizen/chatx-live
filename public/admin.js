'use strict';const $=id=>document.getElementById(id);let adminToken=sessionStorage.getItem('chatx_admin_token')||'',fileSHA='';let msgTimer;let adminCall=null,adminPollTimer=null,adminLastIce=0,adminIceQueue=[];
function feedback(msg){const n=$('adminMessage');n.textContent=msg;n.classList.remove('hidden');clearTimeout(msgTimer);msgTimer=setTimeout(()=>n.classList.add('hidden'),5000)}
async function api(path,opts={}){const response=await fetch('/api/admin'+path,{...opts,headers:{'Content-Type':'application/json',...(adminToken?{Authorization:'Bearer '+adminToken}:{})}});const data=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401){adminToken='';sessionStorage.removeItem('chatx_admin_token');$('adminPanel').classList.add('hidden');$('adminLogin').classList.remove('hidden')}throw Error(data.error||'Server request failed')}return data}
$('adminLoginBtn').onclick=async()=>{try{const d=await api('/login',{method:'POST',body:JSON.stringify({username:$('adminUser').value.trim(),password:$('adminPass').value})});adminToken=d.token;sessionStorage.setItem('chatx_admin_token',adminToken);$('adminPass').value='';$('loginError').classList.add('hidden');showPanel()}catch(e){$('loginError').textContent=e.message;$('loginError').classList.remove('hidden')}};
async function showPanel(){$('adminLogin').classList.add('hidden');$('adminPanel').classList.remove('hidden');await Promise.all([loadSummary(),loadLocations(),loadUsers(),loadSettings()].map(p=>p.catch(e=>feedback(e.message))))}
$('adminLogout').onclick=()=>{adminToken='';sessionStorage.removeItem('chatx_admin_token');if(adminCall)endAdminVideo();$('adminPanel').classList.add('hidden');$('adminLogin').classList.remove('hidden')};
async function loadSummary(){const data=await api('/summary');const box=$('adminStats');box.replaceChildren();for(const [k,v] of Object.entries(data)){const d=document.createElement('div');d.className='stat';const label=document.createElement('small');label.textContent=k;const n=document.createElement('b');n.textContent=String(v);d.append(label,n);box.append(d)}}
async function loadLocations(){const data=await api('/locations');const box=$('adminLocations');box.replaceChildren();if(!data.length)box.textContent='এখন কেউ লোকেশন শেয়ার করছেন না।';for(const u of data){const row=document.createElement('div');row.className='loc-row';const label=document.createElement('div');label.textContent=(u.is_live?'🟢 LIVE':'⚪ LAST KNOWN')+' · @'+u.username+' · '+u.chatx_id+' · '+new Date(u.updated_at).toLocaleString()+' · ±'+Math.round(u.accuracy||0)+' m';const link=document.createElement('a');link.href='https://www.google.com/maps?q='+encodeURIComponent(u.lat+','+u.lng);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Map-এ দেখুন';row.append(label,link);box.append(row)}}
async function loadUsers(){const data=await api('/users');const box=$('adminUsers');box.replaceChildren();for(const u of data){const d=document.createElement('div');d.className='row loc-row';const label=document.createElement('span');label.style.flex='1';label.textContent='@'+u.username+' · '+u.chatx_id;const b=document.createElement('button');b.className='small';b.textContent='📹 Video Call';b.onclick=()=>startAdminVideo(u.id,u.username).catch(e=>feedback(e.message));d.append(label,b);box.append(d)}}
async function loadSettings(){const response=await fetch('/api/settings');const d=await response.json();$('settingAnnouncement').value=d.announcement||'';$('settingSubtitle').value=d.subtitle||'';$('settingAccent').value=d.accent||'#8D42E8';$('settingNotice').value=d.registrationNotice||''}
$('reloadAdmin').onclick=()=>loadSummary().catch(e=>feedback(e.message));$('reloadLocations').onclick=()=>loadLocations().catch(e=>feedback(e.message));
$('saveSettings').onclick=async()=>{try{await api('/settings',{method:'PUT',body:JSON.stringify({settings:{announcement:$('settingAnnouncement').value,subtitle:$('settingSubtitle').value,accent:$('settingAccent').value,registrationNotice:$('settingNotice').value}})});feedback('সেটিংস সংরক্ষিত হয়েছে')}catch(e){feedback(e.message)}};
$('loadFiles').onclick=async()=>{try{const files=await api('/repo/list');const s=$('sourceFile');s.replaceChildren();for(const f of files){const o=document.createElement('option');o.value=f;o.textContent=f;s.append(o)}feedback(files.length+' টি ফাইল পাওয়া গেছে')}catch(e){feedback(e.message)}};
$('loadSource').onclick=async()=>{try{const path=$('sourceFile').value;if(!path)return feedback('একটি ফাইল নির্বাচন করুন');const d=await api('/repo/file?path='+encodeURIComponent(path));$('sourceContent').value=d.content;fileSHA=d.sha;feedback(path+' খোলা হয়েছে')}catch(e){feedback(e.message)}};
$('saveSource').onclick=async()=>{const fresh=$('newSourcePath').value.trim();const path=fresh||$('sourceFile').value;if(!path||(!fresh&&!fileSHA))return feedback('আগে ফাইল খুলুন অথবা New File Path দিন');if(!confirm('GitHub-এ Commit করবেন? Render-এ Manual Deploy লাগতে পারে।'))return;try{const data=await api('/repo/file',{method:'PUT',body:JSON.stringify({path,sha:fresh?'':fileSHA,content:$('sourceContent').value,confirmPassword:$('commitPass').value})});fileSHA=data.sha;$('newSourcePath').value='';$('commitPass').value='';feedback('GitHub Commit সফল: '+(data.commit||''))}catch(e){feedback(e.message)}};
if(adminToken)showPanel();

// Admin targeted video calling: user receives visible invitation and MUST press Accept.
// This UI intentionally does not support unattended webcam or microphone activation.
const adminIceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
async function startAdminVideo(userId,username){
 if(adminCall)return feedback('আগের কল শেষ করুন');
 if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)return feedback('এই ব্রাউজারে Camera/WebRTC পাওয়া যায়নি');
 let stream,pc;try{
  stream=await navigator.mediaDevices.getUserMedia({audio:true,video:{facingMode:'user',width:{ideal:640}}});
  pc=new RTCPeerConnection({iceServers:adminIceServers});
  adminCall={id:null,pc,stream,answerSet:false};
  pc.onicecandidate=e=>{if(!e.candidate)return;const candidate=e.candidate.toJSON();if(adminCall?.id)api('/video/'+adminCall.id+'/ice',{method:'POST',body:JSON.stringify({candidate})}).catch(()=>{});else adminIceQueue.push(candidate)};
  pc.ontrack=e=>{$('adminRemoteVideo').srcObject=e.streams[0]||new MediaStream([e.track]);$('adminRemoteVideo').play().catch(()=>{})};
  pc.onconnectionstatechange=()=>{if(adminCall&&pc.connectionState==='connected')$('adminVideoInfo').textContent='ভিডিও কল সংযুক্ত ✓'};
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  const d=await api('/video/start',{method:'POST',body:JSON.stringify({userId,offer:pc.localDescription.toJSON()})});
  adminCall.id=d.id;$('adminVideoHeading').textContent='📹 @'+username;$('adminVideoInfo').textContent='ব্যবহারকারী Accept করার অপেক্ষা…';
  $('adminLocalVideo').srcObject=stream;$('adminLocalVideo').play().catch(()=>{});$('adminVideoOverlay').classList.remove('hidden');
  for(const candidate of adminIceQueue.splice(0))await api('/video/'+d.id+'/ice',{method:'POST',body:JSON.stringify({candidate})}).catch(()=>{});
  adminLastIce=0;clearInterval(adminPollTimer);adminPollTimer=setInterval(()=>pollAdminVideo().catch(e=>feedback(e.message)),2300);
 }catch(e){if(stream)stream.getTracks().forEach(t=>t.stop());if(pc)pc.close();adminCall=null;throw e}
}
async function pollAdminVideo(){const a=adminCall;if(!a?.id)return;const d=await api('/video/'+a.id);if(adminCall!==a)return;
 if(d.status==='ended')return endAdminVideo(false);
 if(d.status==='ringing'&&Date.now()-new Date(d.created_at).getTime()>90000){feedback('কল গ্রহণ করা হয়নি');return endAdminVideo()}
 if(d.status==='accepted'&&d.answer&&!a.answerSet){await a.pc.setRemoteDescription(d.answer);a.answerSet=true;$('adminVideoInfo').textContent='Connecting…'}
 if(a.pc.remoteDescription){const rows=await api('/video/'+a.id+'/ice?after='+adminLastIce);for(const r of rows){if(adminCall!==a)break;adminLastIce=Math.max(adminLastIce,Number(r.id));try{await a.pc.addIceCandidate(r.candidate)}catch{}}}
}
async function endAdminVideo(send=true){const a=adminCall;adminCall=null;clearInterval(adminPollTimer);adminIceQueue=[];adminLastIce=0;
 if(a?.stream)a.stream.getTracks().forEach(t=>t.stop());if(a?.pc)a.pc.close();
 for(const id of ['adminRemoteVideo','adminLocalVideo']){const el=$(id);el.pause();el.srcObject=null}
 $('adminVideoOverlay').classList.add('hidden');
 if(send&&a?.id)try{await api('/video/'+a.id+'/end',{method:'POST',body:'{}'})}catch(e){feedback(e.message)}
}
$('adminEndVideo').onclick=()=>endAdminVideo();
window.addEventListener('pagehide',()=>{if(adminCall)endAdminVideo()});

// Refresh admin map statuses; stale locations are visibly identified as last known.
setInterval(()=>{if(adminToken && !$('adminPanel').classList.contains('hidden') && document.visibilityState==='visible')loadLocations().catch(()=>{});},20000);

// Page Design Studio: bounded, admin-authenticated structured settings (not arbitrary code execution).
const studioPages=['inbox','chat','registration','stories','profile','vault'];
let pageStyles={};
function drawStudio(){const page=$('studioPage').value;$('studioTitle').value=pageStyles['page_'+page+'_title']||'';const color=pageStyles['page_'+page+'_accent']||pageStyles.accent||'#8D42E8';$('studioAccent').value=/^#[0-9a-fA-F]{6}$/.test(color)?color:'#8D42E8';studioPreview()}
function studioPreview(){$('studioPreviewTitle').textContent=$('studioTitle').value||'ChatX Royal Neon';$('pageDesignStudio').style.setProperty('--studioAccent',$('studioAccent').value)}
$('studioPage').onchange=drawStudio;$('studioTitle').oninput=studioPreview;$('studioAccent').oninput=studioPreview;
$('studioSave').onclick=async()=>{const page=$('studioPage').value;if(!studioPages.includes(page))return;const title=$('studioTitle').value.trim();try{const key1='page_'+page+'_title',key2='page_'+page+'_accent';await api('/settings',{method:'PUT',body:JSON.stringify({settings:{[key1]:title,[key2]:$('studioAccent').value}})});pageStyles[key1]=title;pageStyles[key2]=$('studioAccent').value;feedback('✅ '+page+' page design saved')}catch(e){feedback(e.message)}};
const loadOldSettings=loadSettings;loadSettings=async function(){await loadOldSettings();const d=await (await fetch('/api/settings')).json();pageStyles=d;drawStudio()};
