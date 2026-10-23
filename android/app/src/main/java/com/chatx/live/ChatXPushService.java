package com.chatx.live;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class ChatXPushService extends FirebaseMessagingService {
 static final String PREF="chatx_push_prefs";
 static final String MESSAGE_CHANNEL="chatx_messages_v6",CALL_CHANNEL="chatx_calls_v6";
 static boolean isEnabled(Context ctx){return ctx.getSharedPreferences(PREF,MODE_PRIVATE).getBoolean("enabled",false);}
 static void setEnabled(Context ctx,boolean yes){ctx.getSharedPreferences(PREF,MODE_PRIVATE).edit().putBoolean("enabled",yes).apply();}
 static void disable(Context ctx){setEnabled(ctx,false);if(!FirebaseApp.getApps(ctx).isEmpty())FirebaseMessaging.getInstance().deleteToken().addOnFailureListener(e->Log.w("ChatXPush","Unregister local token failed",e));}
 static void register(Context ctx,String jwt){
  if(!isEnabled(ctx)||jwt==null||jwt.length()<30||FirebaseApp.getApps(ctx).isEmpty())return;
  FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t->{
   new Thread(()->{HttpURLConnection c=null;try{
      c=(HttpURLConnection)new URL(BuildConfig.CHATX_URL+"api/push/register").openConnection();c.setRequestMethod("POST");c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setDoOutput(true);c.setRequestProperty("Authorization","Bearer "+jwt);c.setRequestProperty("Content-Type","application/json");
      byte[] b=new JSONObject().put("deviceToken",t).toString().getBytes(StandardCharsets.UTF_8);try(OutputStream o=c.getOutputStream()){o.write(b);}c.getInputStream().close();
   }catch(Exception e){Log.w("ChatXPush","Token registration failed",e);}finally{if(c!=null)c.disconnect();}}).start();
  }).addOnFailureListener(e->Log.w("ChatXPush","FCM token error",e));
 }
 @Override public void onNewToken(String t){super.onNewToken(t);/* Next authenticated app launch registers the new token. */}
 @Override public void onMessageReceived(RemoteMessage r){
  if(!isEnabled(this))return;
  Map<String,String> d=r.getData();String type=d.getOrDefault("type","message");
  if(!type.equals("message")&&!type.equals("call"))return;
  boolean call=type.equals("call");
  NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
  nm.createNotificationChannel(new NotificationChannel(MESSAGE_CHANNEL,"ChatX Messages",NotificationManager.IMPORTANCE_HIGH));
  NotificationChannel calls=new NotificationChannel(CALL_CHANNEL,"ChatX Incoming Calls",NotificationManager.IMPORTANCE_HIGH);
  calls.enableVibration(true);nm.createNotificationChannel(calls);
  Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  if(call)i.putExtra("open_incoming",true);
  else {String peer=d.get("peerId");if(peer!=null&&peer.matches("[0-9a-fA-F-]{36}"))i.putExtra("open_peer",peer);}
  PendingIntent pi=PendingIntent.getActivity(this,call?208:209,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  String title=d.getOrDefault("title",call?"ChatX Incoming Call":"ChatX Message");
  String body=d.getOrDefault("body",call?"Tap to answer or decline":"New message");
  Notification.Builder b=new Notification.Builder(this,call?CALL_CHANNEL:MESSAGE_CHANNEL)
    .setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle(title).setContentText(body).setContentIntent(pi)
    .setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(call?Notification.CATEGORY_CALL:Notification.CATEGORY_MESSAGE)
    .setPriority(call?Notification.PRIORITY_MAX:Notification.PRIORITY_HIGH);
  if(call){b.setOngoing(false).setDefaults(Notification.DEFAULT_SOUND|Notification.DEFAULT_VIBRATE);
    if(Build.VERSION.SDK_INT<34 || nm.canUseFullScreenIntent())b.setFullScreenIntent(pi,true);
  }
  nm.notify(call?Math.abs(d.getOrDefault("callId","call").hashCode()):Math.abs((d.getOrDefault("peerId","message")).hashCode()),b.build());
 }
}
