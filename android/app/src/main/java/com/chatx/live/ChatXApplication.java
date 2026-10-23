package com.chatx.live;
import android.app.Application;
import android.util.Log;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
public final class ChatXApplication extends Application {
 @Override public void onCreate(){super.onCreate();
  if(BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_API_KEY.isEmpty() || BuildConfig.FIREBASE_SENDER_ID.isEmpty() || BuildConfig.FIREBASE_PROJECT_ID.isEmpty())return;
  try{FirebaseOptions options=new FirebaseOptions.Builder().setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY).setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build();FirebaseApp.initializeApp(this,options);}
  catch(Exception e){Log.e("ChatXFCM","Firebase init failed",e);}
 }
}
