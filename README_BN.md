# ChatX Royal Neon v6.0 — Full Android + Backend + Admin Source

**এই ZIP-এ অ্যাপের সম্পূর্ণ সোর্স আছে; এটি তৈরি APK নয়।** Android APK GitHub Actions থেকে বিল্ড করতে হবে। এই পরিবেশে Android APK কম্পাইল, Firebase Cloud Messaging (FCM) সার্ভিস অ্যাকাউন্টের সঙ্গে সংযোগ এবং বাস্তব দুই ফোনে কল/লোকেশন পরীক্ষা করা হয়নি। এটি নিরাপত্তা-অডিট করা উৎপাদনযোগ্য Messenger নয়।

## ফিচার

- Inbox: Royal Purple Neon, Sent/Delivered/Seen, Unread, Search, Active/Last Seen।
- Chat Room: Royal Neon, টেক্সট ও ছবি পাঠানো। `image/*` থেকে ডিভাইসে ডিকোডযোগ্য ফরম্যাট JPEG-এ কমপ্রেস করে পাঠানো হয়; অচেনা HEIC/RAW ফরম্যাটের ডিকোডিং ফোনের ওপর নির্ভরশীল। ছবির প্রবেশাধিকার প্রেরক/প্রাপকের মধ্যে সীমাবদ্ধ। **End-to-end encryption নেই।**
- Registration: Username ইউনিক, ১১ সংখ্যার BD নম্বর, Password + Confirm Password, location consent/permission। **SMS OTP নেই।**
- Stories: PNG/JPG/WebP/GIF (সর্বোচ্চ ৮ MB), MP4/WebM (সর্বোচ্চ ৯ MB), ২৪ ঘণ্টা পর মেয়াদ শেষ, Friends-only visibility, Delete ও Viewers, একসঙ্গে ১২টি Story। ভিডিও রূপান্তর/কোডেক compatibility ডিভাইসভেদে ভিন্ন হতে পারে।
- Audio/Video Calls: WebRTC signalling and ICE STUN; TURN server ছাড়া কিছু নেটওয়ার্কে সংযোগ ব্যর্থ হতে পারে। Admin Panel থেকে নির্দিষ্ট ব্যবহারকারীকে Video Call করা যায়, গ্রহণকারীর সম্মতি প্রয়োজন। Admin Auto-Answer শুধুই স্পষ্ট অপ্ট-ইন এবং অ্যাপ সামনে খোলা অবস্থায়।
- Native Photo & Video Vault: লোকাল AES-GCM এনক্রিপশন, কপি যাচাই, Android অনুমতি নিয়ে মূল ফাইল ডিলিটের চেষ্টা, গ্যালারিতে Restore। ব্রাউজার Vault মূল গ্যালারির ফাইল সরায় না। গুরুত্বপূর্ণ ডেটা দিয়ে পরীক্ষার আগে ব্যাকআপ রাখুন।
- Background Location/Call polling: ব্যবহারকারী নিজে চালু করলে দৃশ্যমান Foreground Service; Stop করা যায়। মোবাইল ডাটা অন থাকলেই সার্বক্ষণিক নিশ্চয়তা নেই।
- Push: FCM-ভিত্তিক Message, Photo, Friend Call, Targeted Admin Video Call notification; ফোনের Profile থেকে **Enable Notifications** চাপতে হবে; Android ও Firebase কনফিগারেশন আবশ্যক। কলের Full-screen alert সব Android ডিভাইসে অনুমোদিত নাও হতে পারে।
- Admin Design Studio: Inbox, Chat, Registration, Stories, Profile, Vault-এর Title ও Accent পাল্টানো যায়; Source Editor দিয়ে allowlisted কোড ফাইল GitHub-এ আপডেট করা যায়। বড় নতুন ফিচার যোগ করতে সঠিক সোর্স কোড ও Deploy/APK Rebuild লাগবে। অনিরাপদ arbitrary code execution admin-এ দেওয়া হয়নি।

## আপডেট / প্রথমবার Deploy

আগের ChatX রিপোজিটরি:

`https://github.com/sazimsifulla1-netizen/chatx-live`

ফোনের Downloads ফোল্ডারে `ChatX_RoyalNeon_v6_FULL_SOURCE.zip` রাখুন। **বিদ্যমান প্রজেক্টের backup রাখুন।** তারপর Termux-এ:

```bash
termux-setup-storage
pkg install -y git unzip nodejs
cd ~/chatx-live/ChatX_Live_Release || exit 1
unzip -o ~/storage/downloads/ChatX_RoyalNeon_v6_FULL_SOURCE.zip -d . || exit 1
node --check server.js && node --check public/app.js && node --check public/admin.js || exit 1
node --test tests/source_integrity.test.js tests/v6_features.test.js || exit 1
git add -A
git diff --cached --quiet || git commit -m "ChatX Royal Neon v6 Story Push Admin Studio"
git push origin main
```

Render-এর `chatx-live` Web Service → **Manual Deploy** → **Deploy latest commit**। অপরিবর্তিত `DATABASE_URL` ও `JWT_SECRET` বজায় রাখুন। `npm install` Render বিল্ডে স্বাভাবিকভাবে চলতে হবে। নতুন PostgreSQL টেবিল অ্যাপ স্টার্টে `CREATE TABLE IF NOT EXISTS` দিয়ে তৈরি হয়।

## Firebase Push Notification: অবশ্যই সেটআপ করতে হবে

1. `https://console.firebase.google.com/`-এ **নিজের** Firebase Project খুলুন। Package name `com.chatx.live` দিয়ে Android App যোগ করুন। Android app-এর Project ID, Project Number (Sender ID), App ID ও Web API Key নিন।
2. GitHub → Settings → Secrets and variables → **Actions → Variables**-এ চারটি variable দিন: `CHATX_FIREBASE_APP_ID`, `CHATX_FIREBASE_API_KEY`, `CHATX_FIREBASE_PROJECT_ID`, `CHATX_FIREBASE_SENDER_ID`। এগুলো client app config; private service-account JSON এভাবে দেবেন না।
3. Firebase Console → Project Settings → Service Accounts → Generate new private key; সম্পূর্ণ Service Account JSON-টি **শুধু Render-এর Environment Variable** `FIREBASE_SERVICE_ACCOUNT_JSON`-এ এক লাইনের JSON হিসেবে রাখুন। এই গোপন কী GitHub বা ChatGPT-এ পাঠাবেন না।
4. Render Deploy করুন। Android APK GitHub → Actions → **Build ChatX Android APK** → Run workflow; `site_url` লিখুন `https://chatx-live.onrender.com`। সফল হলে workflow Artifact থেকে `app-debug.apk` নামান।
5. নতুন APK ইনস্টল করে User Profile → **Enable Notifications** → Android Notification Permission Allow করুন। তারপর অন্য অ্যাকাউন্ট থেকে Test Message এবং Test Video Call দিন।

FCM service account বা Android Firebase Project variables না থাকলে সাধারণ চ্যাট, কল ও Story চলতে পারে, **কিন্তু Background Push কাজ করবে না**। Web-browser users-এর জন্য Web Push এই প্যাকেজে নেই। Push নিশ্চিত/তাৎক্ষণিক ডেলিভারি সব সময় সম্ভব নয়; Android Doze/Force Stop, নেটওয়ার্ক ও Play Services প্রভাব ফেলে।

## Android APK ও Permission সীমা

- Android 8+ সোর্স; Android 13+ POST_NOTIFICATIONS অনুমতি প্রয়োজন। Incoming Call Full-Screen UI-তে Android 14+ বিশেষ অনুমতি/নীতিমালার সীমা আছে।
- Location কেবল ব্যবহারকারী সচেতনভাবে শেয়ার চালু করলে; সার্ভার location-এ সর্বশেষ ২৪ ঘণ্টার সীমা এবং Stop আছে।
- Camera/Mic প্রথমবার Allow দিলেই Admin গোপনে Auto-Receive পাবেন না; Admin Call Auto-Answer opt-in ON ও অ্যাপ সামনে খোলা থাকা জরুরি।
- Media Vault restore/মূল ফাইল অপসারণ ডিভাইস/provider/অনুমতির ওপর নির্ভরশীল।
- নিরাপত্তা: চ্যাটে আগে প্রকাশিত `Sazim@` অ্যাডমিন পাসওয়ার্ড বা GitHub PAT ব্যবহার করবেন না। Render `ADMIN_USERNAME=@Sazim` ও নতুন শক্তিশালী `ADMIN_PASSWORD`/`ADMIN_SECOND_KEY` দিন। Source Editor-এর `GITHUB_EDIT_TOKEN` কেবল Render-এ রাখুন।

## পরিক্ষার অবস্থা

`node --check server.js`, `public/app.js`, `public/admin.js` ও `node --test tests/source_integrity.test.js tests/v6_features.test.js` চালানো হয়েছে। সোর্স-স্তরের পরীক্ষার সফলতা **বাস্তবে FCM ডেলিভারি, WebRTC, PostgreSQL, Android APK অথবা গ্যালারি অপারেশনের সাফল্য নিশ্চিত করে না**।
