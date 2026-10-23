# ChatX Royal Purple v3 — Android + Render + GitHub

**অবস্থা:** আপডেটেড সোর্স প্রজেক্ট। JavaScript সিনট্যাক্স ও Chrome-এর মৌলিক UI (৩-ট্যাপ Gate, রেজিস্ট্রেশন ফর্ম, প্রোফাইল) পরীক্ষা করা হয়েছে। Render/PostgreSQL-এ v3 ডেপ্লয়, দুইটি আসল ফোনে অডিও কল এবং GitHub Actions-এ APK Build এখনো সম্পূর্ণ পরীক্ষা হয়নি। এটিকে পূর্ণ প্রোডাকশন Messenger বলবেন না।

## ফিচার
- Android Launcher-এ একবার আইকন ট্যাপ করলে Android নিয়ম অনুযায়ী অ্যাপ শুরু হয়, তবে **ChatX-এ প্রবেশ করতে গেট স্ক্রিনে ১.৭ সেকেন্ডের মধ্যে তিনবার ট্যাপ** করতে হবে। পাঁচবার ট্যাপে অ্যাপের লোগো Admin Login পেজ খুলবে। এটি নিরাপত্তা PIN নয়; কেবল UI প্রবেশপথ।
- মোবাইল নম্বর, ইউনিক ইউজারনেম, কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড; লাল/সবুজ বৈধতা নির্দেশক, সুন্দর Error Notice ও Loading Overlay। ৬ অক্ষর অনুমোদিত হলেও ১০+ অক্ষরের পাসওয়ার্ড নিরাপদ। SMS OTP এখনো নেই।
- ChatX ID দিয়ে Friend Add/Accept, Text Chat, ৪.৫ সেকেন্ডে নতুন চ্যাট দেখা এবং ১২ ঘণ্টা পরপর তালিকা রিফ্রেশ। রিফ্রেশে ইতিহাস মোছা হয় না।
- Photo Avatar (ছবি সংক্ষিপ্ত করে সার্ভারে সংরক্ষণ)।
- **লাইভ লোকেশন শেয়ার ঐচ্ছিক এবং স্বচ্ছ:** User সম্মতি দিলে এবং অ্যাপ সামনে খোলা থাকলে ২৫ সেকেন্ড অন্তর পাঠানো হয়। শেয়ার শুরু/বন্ধ বোতাম ও হেডারে দৃশ্যমান ইন্ডিকেটর আছে; Admin সক্রিয় শেয়ার দেখতে পারবেন। অ্যাপ বন্ধ/ব্যাকগ্রাউন্ডে গেলে বন্ধ করার চেষ্টা হয়; হঠাৎ বন্ধ হলেও সার্ভার TTL সর্বোচ্চ প্রায় ৭০ সেকেন্ডে শেয়ার অকার্যকর করে। রেজিস্ট্রেশন বাধ্যতামূলক লোকেশন-নির্ভর নয়। Android-এর Location Permission লাগবে।
- **Audio Call (পরীক্ষামূলক WebRTC):** দুই বন্ধু সম্মতি দিয়ে কল করতে পারেন; ব্রাউজার/Android-এ মাইক্রোফোনের অনুমতি দরকার। এটি শুধুমাত্র STUN দিয়ে শুরু হয়—কিছু নেটওয়ার্কে সঠিকভাবে সংযোগ করতে TURN সার্ভার লাগবে। সার্ভার অডিও রেকর্ড বা সংরক্ষণ করে না।
- **Private Photo Vault:** AES-GCM, PBKDF2 (220k iterations) দিয়ে ব্রাউজারের IndexedDB-তে এনক্রিপ্ট করা ছবি। আলাদা ৮+ অক্ষরের ভল্ট পাসওয়ার্ড, Lock/Unlock/Delete। **ছবি সার্ভারে/অ্যাডমিনে যায় না**, এবং ব্রাউজার/অ্যাপ ডেটা মুছলে ছবি হারাবে; ভল্ট পাসওয়ার্ড ভুলে গেলে উদ্ধার করা সম্ভব নয়। কোনো স্বয়ংক্রিয় ক্লাউড ব্যাকআপ নেই।
- **Admin Panel:** নিরাপদ Username + ১২+ অক্ষরের Password + ১২+ অক্ষরের Second Key; ১৫ মিনিট Admin Session। ব্যবহারকারীর সংখ্যা, অনুমোদিত সক্রিয় লোকেশন, UI সেটিংস, GitHub Source Read/Update/Create (শুধু নির্দিষ্ট ফাইল)। অন্য ব্যবহারকারীর লক করা ছবি বা কথোপকথন দেখানোর সুযোগ নেই। GitHub Commit করার পর Render যদি Public Git Repository দিয়ে তৈরি হয়ে থাকে, **Manual Deploy** করতে হবে।

## ১. নতুন ZIP দিয়ে আগের GitHub প্রজেক্ট আপডেট (Termux)
ChatGPT থেকে `ChatX_Live_RoyalPurple_v3_Upgrade.zip` **Download** করুন। এর ZIP-এ ফাইলগুলো repository root অনুযায়ী আছে; `.git` নেই।

```bash
cd ~/chatx-live/ChatX_Live_Release || exit 1
unzip -o ~/storage/downloads/ChatX_Live_RoyalPurple_v3_Upgrade.zip -d .
node --check server.js
node --check public/app.js
node --check public/admin.js
git add -A
git commit -m "ChatX Royal Purple v3 update"
git push origin main
```

যদি ZIP ফোনে `-1.zip` নামে সেভ হয়, File Manager-এ নাম দেখে কমান্ডে সেই নাম দিন। গুরুত্বপূর্ণ: **নতুন করে git init/remote পরিবর্তন করার দরকার নেই।**

## ২. Render Deploy
[Render Dashboard](https://dashboard.render.com/) → `chatx-live` Web Service → **Manual Deploy → Deploy latest commit**। Web Service-এর Environment Variable-এ নিম্নেরগুলো রাখুন:

- `DATABASE_URL` = আপনার `chatx-db`-এর Render **Internal Database URL** (গোপন)
- `JWT_SECRET` = আগের একই ৩২+ অক্ষরের Secret (বদলালে আগের লগইন সেশন বাতিল হবে)
- `NODE_ENV` = `production`
- `ADMIN_USERNAME` = নিজের অ্যাডমিন নাম
- `ADMIN_PASSWORD` = অন্তত ১২ অক্ষরের শক্তিশালী আলাদা পাসওয়ার্ড
- `ADMIN_SECOND_KEY` = অন্তত ১২ অক্ষরের দ্বিতীয় গোপন কী
- `GITHUB_REPOSITORY` = `sazimsifulla1-netizen/chatx-live`
- `GITHUB_EDIT_TOKEN` = **ঐচ্ছিক**, ফাইল এডিটের জন্য শুধু ওই repo-তে Contents Read/Write (workflow ফাইল এডিটের জন্য Workflows Read/Write) যুক্ত একটি ন্যূনতম অধিকারযুক্ত PAT। GitHub-এ দেওয়া নয়, Render Secret Variable-এ দিন। আগে চ্যাটে প্রকাশিত টোকেন কখনো ব্যবহার করবেন না।

রিড-অনলি Admin Panel-এর জন্য `GITHUB_EDIT_TOKEN` প্রয়োজন নেই; শুধু Source Editor-এ লাগবে। Render Logs-এ `ChatX v3 listening` এবং `https://chatx-live.onrender.com/api/health`-এ `ok:true` দেখা গেলে সার্ভার পরীক্ষা শুরু করতে পারেন। ডাটাবেস Schema `CREATE TABLE IF NOT EXISTS` দিয়ে প্রথম স্টার্টে তৈরি হয়; আগে সংরক্ষিত User/Friends/Messages রাখা হয়। Production database-এ schema change-এর আগে backup নিয়ে নিন।

## ৩. দুই ফোনের পরীক্ষা
1. দুই ফোনে `https://chatx-live.onrender.com` খুলে গেটের বড় ChatX বোতামে দ্রুত ৩ বার ট্যাপ করুন।
2. আলাদা নম্বর/ইউজারনেম/পাসওয়ার্ড দিয়ে Register করুন। OTP না থাকায় কোনো নম্বরের মালিকানা যাচাই হয় না।
3. একটি ফোনের CX-ID অন্য ফোনে People থেকে Search করে Add করুন; প্রথম ফোনে Accept করুন।
4. Chats → Chat থেকে লেখা পাঠান; Audio Call বোতামে চাপ দিয়ে দুই ফোনে Microphone Allow দিয়ে কল পরীক্ষা করুন। দুই ফোন একই Wi-Fi-তে আগে পরীক্ষা করতে পারেন। ভিন্ন নেটওয়ার্কে TURN ছাড়া কল ব্যর্থ হতে পারে।
5. Profile → Live Location → সম্মতি দিয়ে শেয়ার; অন্য অ্যাকাউন্ট থেকে লোকেশন দেখা যাবে না; Admin Panel-এ অনুমোদিত অবস্থান দেখুন। Stop করলে বন্ধ হবে।
6. Vault থেকে ডিভাইসে ছবি Encrypt ও Unlock পরীক্ষা করুন। **মূল গ্যালারির ছবি অক্ষত থাকবে**; Vault-এর ছবি আলাদা এনক্রিপ্ট কপি।

## ৪. Android APK Build
GitHub Repository → Actions → `Build ChatX Android APK` → Run workflow → site_url = `https://chatx-live.onrender.com` → Run। Workflow-এ `android-actions/setup-android@v4` ব্যবহার করা হয়েছে, যা পুরোনো `tools` প্যাকেজ-সংক্রান্ত GitHub Actions Error এড়ায়। সফল হলে Artifacts → `ChatX-debug-APK` থেকে ZIP নামিয়ে `app-debug.apk` ইনস্টল করুন।

এটি WebView-based Android wrapper, সম্পূর্ণ Native Messenger নয়। Android-এর App Icon একবার ট্যাপ করলেই Gate Screen আসে; অ্যাপের ভেতর ৩ ট্যাপে ChatX খোলে। Android OS-এর launcher-এর প্রথম tap বন্ধ করা সম্ভব নয়।

## ৫. নিরাপত্তা ও সীমাবদ্ধতা
- চ্যাট বার্তা PostgreSQL-এ সংরক্ষিত কিন্তু **End-to-End Encrypted নয়**। ব্যক্তিগত গোপন তথ্যের জন্য production security review ছাড়া ব্যবহার করবেন না।
- Phone verification, password reset, push notifications, TURN server, E2EE, WebRTC reliability testing, photo-vault encrypted backup/restore, content reporting, anti-spam, accessibility, privacy policy, location retention audit এবং Android signed release এখনও দরকার।
- Render Free PostgreSQL সময়সীমা ও ডেটা সংরক্ষণের সীমাবদ্ধতা আছে। গুরুত্বপূর্ণ চ্যাট/অ্যাকাউন্টের জন্য backup সহ উপযুক্ত প্ল্যান দরকার।
- APK Build, দুই ফোনে Audio Call এবং পূর্ণ Backend API-এর End-to-End Test এখনও সফল প্রমাণিত নয়।
