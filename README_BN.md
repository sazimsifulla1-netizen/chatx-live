# ChatX Royal Purple — Live Text Chat Release

এই প্যাকেজে Node.js + PostgreSQL সার্ভার, মোবাইল Web App এবং Android WebView wrapper প্রজেক্ট রয়েছে। **এটি লাইভ টেক্সট চ্যাট MVP, পূর্ণ Messenger নয়।** কল, মিডিয়া, OTP, E2EE, Push Notification নেই। Android APK এখনো বিল্ড করে যাচাই করা হয়নি।

## ১. GitHub
নতুন GitHub repository `chatx-live` খুলুন। ZIP Extract করে সব ফাইল repo root-এ আপলোড করুন (শুধু ZIP আপলোড করবেন না)। `.github/workflows/android-apk.yml`-ও থাকতে হবে।

## ২. PostgreSQL
Render Dashboard-এ PostgreSQL তৈরি করুন (অথবা অন্য hosted PostgreSQL provider)। **Internal Database URL** কপি করুন যদি Render-এর একই অঞ্চলের সার্ভার থেকে ব্যবহার করেন। অন্য provider হলে SSL connection URL ব্যবহার করুন। ডেটাবেসের Free/Paid availability Render-এর বর্তমান প্ল্যান অনুযায়ী দেখুন। SQLite ব্যবহার করবেন না; Render ephemeral disk-এ ডেটা হারাতে পারে।

## ৩. Render Web Service
New > Web Service > Connect GitHub `chatx-live`; runtime Node; Build Command `npm install`; Start Command `npm start`; Environment:
- `DATABASE_URL`: PostgreSQL connection URL (secret)
- `JWT_SECRET`: কমপক্ষে ৩২ অক্ষরের random secret (secret)
- `NODE_ENV`: production

Render URL যেমন `https://chatx-live.onrender.com` পাওয়া গেলে Chrome-এ URL খুলুন। `https://YOUR-RENDER-URL/api/health`-এ `{ "ok": true }` দেখা উচিত। URL অনুমান করে ব্যবহার করবেন না।

## ৪. দুই ফোনে পরীক্ষা
- Phone A: Render URL খুলে `017...` নম্বর, ইউনিক username, ১০+ অক্ষরের password দিয়ে Register করুন। নিজের CX- ID কপি করুন।
- Phone B: একই URL খুলে **অন্য নম্বর** ও username দিয়ে Register করুন। People > Search-এ Phone A-এর CX- ID দিন > Add।
- Phone A: People > Requests > Accept।
- দুই ফোনে Chats > Chat থেকে মেসেজ পাঠান। কয়েক সেকেন্ডের মধ্যে রিফ্রেশ হবে।
- ব্রাউজার বন্ধ করে আবার খুলুন: ৩০ দিনের বৈধ JWT থাকলে লগইন থাকবে। ব্রাউজার data clear করলে লগইন চলে যাবে।

**সতর্কতা:** SMS OTP নেই; নম্বরের মালিকানা যাচাই হয় না। এটি পরীক্ষামূলক সিস্টেম; বাস্তব ব্যক্তিগত তথ্য/গোপন বার্তা আদান-প্রদানের জন্য নয়। সাধারণ HTTPS transport encryption আছে কিন্তু End-to-End Encryption নেই।

## ৫. GitHub Actions দিয়ে APK
GitHub repository > Actions > `Build ChatX Android APK` > Run workflow > `site_url`-এ নিজের Render HTTPS URL লিখুন > Run। সফল হলে workflow Artifacts-এ `ChatX-debug-APK` পাওয়া যাবে। ZIP download করে `app-debug.apk` Extract ও Install করুন। Android-এ unknown-source install permission লাগতে পারে। APK debug signed, Play Store release নয়। Android app-এর মধ্যে ওয়েব UI দেখাবে; সার্ভার অনলাইন না থাকলে কাজ করবে না।

## ৬. Local development
`npm install`, তারপর PostgreSQL চালিয়ে `DATABASE_URL` ও `JWT_SECRET` set করে `npm start`; `npm test` শুধু input-validation unit tests চালায়।

## ৭. সীমাবদ্ধতা ও production checklist
OTP/phone verification, E2EE, spam controls, password recovery, token revocation, privacy policy, content reporting, accessibility, notification, backups, observability, Android native navigation এবং security review এখনও প্রয়োজন। Render free service sleep করলে message delivery delay হতে পারে। Friend data PostgreSQL-এ থাকবে যতদিন DB সক্রিয় ও data retained।
