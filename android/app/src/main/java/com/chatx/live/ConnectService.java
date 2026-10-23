package com.chatx.live;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Visible, explicitly user-started foreground service. Never activates the camera/microphone.
 * Continues only while the OS permits the user-visible foreground service. Force-stop ends it.
 * Its CALL notifications require the user to open ChatX and Accept every video/audio call.
 */
public final class ConnectService extends Service {
    public static final String ACTION_START="com.chatx.live.CONNECT_START";
    public static final String ACTION_STOP="com.chatx.live.CONNECT_STOP";
    public static final String EXTRA_TOKEN="token",EXTRA_LOCATION="location",EXTRA_CALLS="calls";
    private static final int STATUS_NOTIFICATION=5300, CALL_NOTIFICATION=5301;
    private static final String STATUS_CHANNEL="chatx_connected_v1",CALL_CHANNEL="chatx_incoming_v1";
    public static volatile boolean running=false, locationEnabled=false, callsEnabled=false;
    private volatile String userToken="";
    private volatile Location latestLocation;
    private volatile boolean initialLocationSent=false;
    private volatile boolean stopping=false;
    private volatile String notifiedCallId="";
    private long lastLocationPost=0L;
    private LocationManager locationManager;
    private ScheduledExecutorService executor;
    private final LocationListener listener=new LocationListener(){
        @Override public void onLocationChanged(Location l){if(l!=null)latestLocation=l;}
        @Override public void onStatusChanged(String provider,int status,Bundle extras){}
        @Override public void onProviderEnabled(String provider){}
        @Override public void onProviderDisabled(String provider){}
    };

    @Override public void onCreate(){super.onCreate();
        NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(STATUS_CHANNEL,"ChatX background connection",NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CALL_CHANNEL,"ChatX incoming calls",NotificationManager.IMPORTANCE_HIGH));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null)return START_NOT_STICKY;
        if(ACTION_STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(!ACTION_START.equals(intent.getAction()))return START_NOT_STICKY;
        String received=intent.getStringExtra(EXTRA_TOKEN);
        if(received==null||received.length()<30){stopSelf();return START_NOT_STICKY;}
        userToken=received;
        boolean enableLocation=intent.getBooleanExtra(EXTRA_LOCATION,false);
        boolean enableCalls=intent.getBooleanExtra(EXTRA_CALLS,false);
        if(!enableLocation&&!enableCalls){stopSelf();return START_NOT_STICKY;}
        if(enableLocation && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            stopSelf();return START_NOT_STICKY;
        }
        boolean locationWasEnabled=locationEnabled;
        locationEnabled=enableLocation;callsEnabled=enableCalls;stopping=false;
        try {
            int types=0;
            if(Build.VERSION.SDK_INT>=29&&locationEnabled)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            if(Build.VERSION.SDK_INT>=34&&callsEnabled)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING;
            if(Build.VERSION.SDK_INT>=29)startForeground(STATUS_NOTIFICATION,buildStatusNotification(),types);
            else startForeground(STATUS_NOTIFICATION,buildStatusNotification());
        }catch(Exception e){Log.e("ChatXConnect","Foreground service unavailable",e);stopSelf();return START_NOT_STICKY;}
        running=true;
        if(locationEnabled&&!locationWasEnabled){initialLocationSent=false;latestLocation=null;lastLocationPost=0;beginLocation();}
        if(!locationEnabled&&locationWasEnabled){endLocation();asyncServerStop();}
        if(executor==null||executor.isShutdown()){
            executor=Executors.newSingleThreadScheduledExecutor();
            executor.scheduleWithFixedDelay(this::poll,2,10,TimeUnit.SECONDS);
        }
        return START_NOT_STICKY;
    }
    private Notification buildStatusNotification(){
        PendingIntent open=PendingIntent.getActivity(this,10,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stopIntent=new Intent(this,ConnectService.class).setAction(ACTION_STOP);
        PendingIntent stop=PendingIntent.getService(this,11,stopIntent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        String detail=locationEnabled?(callsEnabled?"Live location + call alerts active":"Live location sharing active"):"Incoming call alerts active";
        return new Notification.Builder(this,STATUS_CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("ChatX · Background connection ON")
                .setContentText(detail+" · Tap STOP to switch off")
                .setContentIntent(open).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,"STOP",stop).build()).build();
    }
    private void beginLocation(){
        locationManager=(LocationManager)getSystemService(LOCATION_SERVICE);
        try {
            if(locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER,12000,8f,listener);
            if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,12000,8f,listener);
        }catch(SecurityException|IllegalArgumentException e){Log.w("ChatXConnect","Location unavailable: "+e.getMessage());}
    }
    private void endLocation(){if(locationManager!=null)try{locationManager.removeUpdates(listener);}catch(SecurityException ignored){};latestLocation=null;initialLocationSent=false;}
    private void poll(){
        if(stopping||!running||userToken.isEmpty())return;
        if(locationEnabled&&SystemClock.elapsedRealtime()-lastLocationPost>=22000){
            try{sendLocation();}catch(Exception e){Log.w("ChatXConnect","Location update failed: "+e.getMessage());}
        }
        if(callsEnabled)try{pollIncomingCalls();}catch(Exception e){Log.w("ChatXConnect","Call notification check failed: "+e.getMessage());}
    }
    private void sendLocation() throws Exception{
        Location l=latestLocation;
        if(l==null)return;
        if(SystemClock.elapsedRealtimeNanos()-l.getElapsedRealtimeNanos()>TimeUnit.MINUTES.toNanos(2))return;
        if(l.hasAccuracy()&&l.getAccuracy()>50000)return;
        JSONObject point=new JSONObject();point.put("lat",l.getLatitude());point.put("lng",l.getLongitude());point.put("accuracy",l.hasAccuracy()?l.getAccuracy():1000);
        JSONObject body=new JSONObject();body.put("location",point);
        // Registration itself grants foreground sharing; native background mode needs separate explicit consent.
        if(!initialLocationSent)body.put("consent",true);
        Response resp=send(initialLocationSent?"/api/location/update":"/api/location/start","POST",body);
        if(resp.status==401){stopSelf();return;}
        if(resp.status==409){ // Revoked from another session: never silently restart.
            stopSelf();return;
        }
        if(resp.status<200||resp.status>=300)throw new IOException("Location API HTTP "+resp.status);
        initialLocationSent=true;lastLocationPost=SystemClock.elapsedRealtime();
    }
    private void pollIncomingCalls() throws Exception{
        Response admin=send("/api/video/admin/incoming","GET",null);
        if(admin.status==401){stopSelf();return;}
        if(admin.status==200){JSONArray a=new JSONArray(admin.body);if(a.length()>0){
            JSONObject call=a.getJSONObject(0);notifyIncoming(call.optString("id"),"ChatX Admin",true);return;
        }}
        Response friends=send("/api/calls/incoming","GET",null);
        if(friends.status==200){JSONArray a=new JSONArray(friends.body);if(a.length()>0){
            JSONObject call=a.getJSONObject(0);notifyIncoming(call.optString("id"),call.optString("username","Friend"),false);return;
        }}
        notifiedCallId="";
    }
    private void notifyIncoming(String id,String sender,boolean admin){
        if(id.isEmpty()||id.equals(notifiedCallId))return;
        notifiedCallId=id;
        Intent launch=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("open_incoming",true);
        PendingIntent open=PendingIntent.getActivity(this,33,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification n=new Notification.Builder(this,CALL_CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle((admin?"Admin":"Friend")+" video/audio call · "+sender)
            .setContentText("Incoming call · Tap to open ChatX, then Accept or Decline")
            .setCategory(Notification.CATEGORY_CALL).setPriority(Notification.PRIORITY_HIGH)
            .setAutoCancel(true).setContentIntent(open).build();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(CALL_NOTIFICATION,n);
    }
    private static final class Response{final int status;final String body;Response(int s,String b){status=s;body=b;}}
    private Response send(String route,String method,JSONObject data)throws Exception{
        // Server root is baked into BuildConfig at APK build time; arbitrary URLs are never accepted.
        URL u=new URL(BuildConfig.CHATX_URL+route.substring(1));
        HttpURLConnection c=(HttpURLConnection)u.openConnection();
        c.setConnectTimeout(8500);c.setReadTimeout(8500);c.setRequestMethod(method);
        c.setRequestProperty("Authorization","Bearer "+userToken);
        c.setRequestProperty("Accept","application/json");
        if(data!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
            try(OutputStream os=c.getOutputStream()){os.write(data.toString().getBytes(StandardCharsets.UTF_8));}}
        int status=c.getResponseCode();String body="";
        try(InputStream in=status<400?c.getInputStream():c.getErrorStream()){
            if(in!=null){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[4096];int n;
                while((n=in.read(buf))>0&&b.size()<250000)b.write(buf,0,n);body=b.toString("UTF-8");}
        }finally{c.disconnect();}
        return new Response(status,body);
    }
    private void asyncServerStop(){
        String original=userToken;if(original.isEmpty())return;
        // Stopping means the admin cannot fetch any new or retained coordinates.
        new Thread(()->{
            HttpURLConnection c=null;
            try{
                c=(HttpURLConnection)new URL(BuildConfig.CHATX_URL+"api/location/stop").openConnection();
                c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setRequestMethod("POST");
                c.setRequestProperty("Authorization","Bearer "+original);
                c.setRequestProperty("Content-Type","application/json");c.setDoOutput(true);
                try(OutputStream out=c.getOutputStream()){out.write("{}".getBytes(StandardCharsets.UTF_8));}
                c.getResponseCode();
            }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
        },"chatx-revoke-location").start();
    }
    @Override public void onDestroy(){
        boolean wasLocation=locationEnabled;stopping=true;running=false;locationEnabled=false;callsEnabled=false;
        endLocation();if(executor!=null)executor.shutdownNow();
        if(wasLocation)asyncServerStop();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).cancel(CALL_NOTIFICATION);
        userToken="";
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent i){return null;}
}
