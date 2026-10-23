package com.chatx.live;

import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.app.AlertDialog;
import android.content.Context;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMedia;
    private String[] pendingResources;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private static final int PICK_IMAGE = 202;
    private static final int MEDIA_PERMISSION = 203;
    private static final int LOCATION_PERMISSION = 204;
    private static final int BACKGROUND_LOCATION_PERMISSION = 205;
    private static final int CONNECT_NOTIFICATION_PERMISSION = 206;
    private String pendingToken;
    private boolean pendingLocation, pendingCalls;
    private boolean openIncomingAfterLoad=false;
    private String openPeerAfterLoad=null;
    private String pushConsentToken=null;
    private static final int PUSH_PERMISSION=207;
    public final class NativePushBridge {
        @JavascriptInterface public void register(String jwt){runOnUiThread(()->{
           if(web!=null && web.getUrl()!=null && trusted(Uri.parse(web.getUrl())) && ChatXPushService.isEnabled(MainActivity.this))ChatXPushService.register(MainActivity.this,jwt);
        });}
        @JavascriptInterface public void enable(String jwt){runOnUiThread(()->{
           if(web==null||web.getUrl()==null||!trusted(Uri.parse(web.getUrl()))||jwt==null||jwt.length()<30)return;
           new AlertDialog.Builder(MainActivity.this).setTitle("Enable ChatX Notifications?")
             .setMessage("ChatX will display message previews and incoming call alerts. Android notification settings can be changed any time. No call auto-answers.")
             .setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("ENABLE",(d,w)->{
               pushConsentToken=jwt;
               if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                  requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},PUSH_PERMISSION);
               else finishPushOptIn();
             }).show();
        });}
        @JavascriptInterface public void disable(){runOnUiThread(()->ChatXPushService.disable(MainActivity.this));}
    }
    private void finishPushOptIn(){
      if(pushConsentToken!=null){ChatXPushService.setEnabled(this,true);ChatXPushService.register(this,pushConsentToken);pushConsentToken=null;}
    }


    public final class NativeConnectBridge {
        @JavascriptInterface public boolean isBackgroundLocationOn(){return ConnectService.running && ConnectService.locationEnabled;}
        @JavascriptInterface public boolean isBackgroundCallsOn(){return ConnectService.running && ConnectService.callsEnabled;}
        @JavascriptInterface public void startBackground(String token,boolean location,boolean calls){
            runOnUiThread(()->{
                if(web==null || web.getUrl()==null || !trusted(Uri.parse(web.getUrl())) || token==null || token.length()<30 || (!location&&!calls))return;
                pendingToken=token;pendingLocation=location;pendingCalls=calls;
                String detail=location ? "ChatX will share your location with its administrator even while other apps are open. A persistent notification and STOP action remain visible. Incoming call notifications will also work while this foreground service is running." : "ChatX will check for incoming calls while a visible foreground-service notification is active. Calls never auto-answer.";
                new AlertDialog.Builder(MainActivity.this).setTitle("Enable ChatX Background Connection?")
                    .setMessage(detail+"\n\nThis may use additional battery and mobile data. You can stop it any time.")
                    .setNegativeButton("Cancel",(d,w)->clearPending())
                    .setPositiveButton("ENABLE",(d,w)->ensureConnectPermissions()).show();
            });
        }
        @JavascriptInterface public void stopBackground(){runOnUiThread(()->{
            stopService(new Intent(MainActivity.this,ConnectService.class).setAction(ConnectService.ACTION_STOP));
            notifyConnectState();
        });}
    }
    private void clearPending(){pendingToken=null;pendingCalls=false;pendingLocation=false;}
    private void ensureConnectPermissions(){
        if(pendingToken==null)return;
        if(pendingLocation && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},BACKGROUND_LOCATION_PERMISSION);
            return;
        }
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},CONNECT_NOTIFICATION_PERMISSION);
            return;
        }
        Intent i=new Intent(this,ConnectService.class).setAction(ConnectService.ACTION_START);
        i.putExtra(ConnectService.EXTRA_TOKEN,pendingToken);
        i.putExtra(ConnectService.EXTRA_LOCATION,pendingLocation);
        i.putExtra(ConnectService.EXTRA_CALLS,pendingCalls);
        clearPending();
        if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);
        web.postDelayed(this::notifyConnectState,700);
    }
    private void notifyConnectState(){
        if(web!=null && web.getUrl()!=null && trusted(Uri.parse(web.getUrl())))
            web.evaluateJavascript("window.dispatchEvent(new Event('chatx-native-ready'));",null);
    }


    private Uri base() { return Uri.parse(BuildConfig.CHATX_URL); }
    private boolean trusted(Uri u) {
        Uri b = base();
        return u != null && "https".equalsIgnoreCase(u.getScheme())
                && b.getHost() != null && b.getHost().equalsIgnoreCase(u.getHost())
                && ((u.getPort() == -1 || u.getPort() == 443) && (b.getPort() == -1 || b.getPort() == 443));
    }
    private boolean trustedOrigin(String str) { try { return trusted(Uri.parse(str)); } catch(Exception e) {return false;} }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        web.addJavascriptInterface(new NativeConnectBridge(),"ChatXAndroid");
        web.addJavascriptInterface(new NativePushBridge(),"ChatXPush");
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view,String url) {
                if(trusted(Uri.parse(url))){
                    view.evaluateJavascript("window.ChatXNativeVaultEnabled=true; window.dispatchEvent(new Event('chatx-native-ready'));",null);
                    if(openIncomingAfterLoad){openIncomingAfterLoad=false;view.evaluateJavascript("window.ChatXEnterFromNotification?.();",null);}
                    if(openPeerAfterLoad!=null){String id=openPeerAfterLoad;openPeerAfterLoad=null;if(id.matches("[0-9a-fA-F-]{36}"))view.evaluateJavascript("window.ChatXOpenPeerFromNotification?.('"+id+"');",null);}
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u=request.getUrl();
                if("chatx".equalsIgnoreCase(u.getScheme()) && "vault".equalsIgnoreCase(u.getHost())) {
                    startActivity(new Intent(MainActivity.this, VaultActivity.class));
                    return true;
                }
                if(trusted(u)) return false;
                if("https".equalsIgnoreCase(u.getScheme()) || "http".equalsIgnoreCase(u.getScheme()))
                    startActivity(new Intent(Intent.ACTION_VIEW,u));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> cb,FileChooserParams params) {
                if(fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback=cb;
                try { startActivityForResult(params.createIntent(),PICK_IMAGE); return true; }
                catch(Exception e) {fileCallback=null;cb.onReceiveValue(null);return false;}
            }
            @Override public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(() -> {
                    if(!trusted(req.getOrigin())) { req.deny(); return; }
                    java.util.List<String> resources = new java.util.ArrayList<>();
                    java.util.List<String> permissions = new java.util.ArrayList<>();
                    for(String r:req.getResources()) {
                        if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                            resources.add(r);
                            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)
                                permissions.add(Manifest.permission.RECORD_AUDIO);
                        } else if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                            resources.add(r);
                            if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)
                                permissions.add(Manifest.permission.CAMERA);
                        }
                    }
                    if(resources.isEmpty() || resources.size()!=req.getResources().length) { req.deny(); return; }
                    if(permissions.isEmpty()) req.grant(resources.toArray(new String[0]));
                    else {
                        pendingMedia=req;
                        pendingResources=resources.toArray(new String[0]);
                        requestPermissions(permissions.toArray(new String[0]),MEDIA_PERMISSION);
                    }
                });
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback cb){
                if(!trustedOrigin(origin)){cb.invoke(origin,false,false);return;}
                boolean fine=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
                boolean coarse=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
                if(fine||coarse)cb.invoke(origin,true,false);
                else {pendingGeo=cb;pendingGeoOrigin=origin;requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_PERMISSION);}
            }
        });
        setContentView(web);
        openIncomingAfterLoad=getIntent()!=null && getIntent().getBooleanExtra("open_incoming",false);
        openPeerAfterLoad=getIntent()==null?null:getIntent().getStringExtra("open_peer");
        web.loadUrl(BuildConfig.CHATX_URL);
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        boolean ok=false;for(int g:grants)if(g==PackageManager.PERMISSION_GRANTED)ok=true;
        if(requestCode==MEDIA_PERMISSION && pendingMedia!=null){
            boolean granted=true;
            for(String r:pendingResources) {
                String p=PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)?Manifest.permission.RECORD_AUDIO:Manifest.permission.CAMERA;
                if(checkSelfPermission(p)!=PackageManager.PERMISSION_GRANTED) granted=false;
            }
            if(granted)pendingMedia.grant(pendingResources);else pendingMedia.deny();
            pendingMedia=null;pendingResources=null;
        }
        if(requestCode==LOCATION_PERMISSION && pendingGeo!=null){pendingGeo.invoke(pendingGeoOrigin,ok,false);pendingGeo=null;pendingGeoOrigin=null;}
        if(requestCode==BACKGROUND_LOCATION_PERMISSION){
            if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)ensureConnectPermissions();
            else {clearPending();new AlertDialog.Builder(this).setMessage("Location permission is needed for background sharing.").setPositiveButton("OK",null).show();}
        }
        if(requestCode==PUSH_PERMISSION){
            if(Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)finishPushOptIn();
            else pushConsentToken=null;
        }
        if(requestCode==CONNECT_NOTIFICATION_PERMISSION){
            if(Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)ensureConnectPermissions();
            else {clearPending();new AlertDialog.Builder(this).setMessage("Allow notifications to use incoming call alerts.").setPositiveButton("OK",null).show();}
        }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_IMAGE && fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleNotificationIntent(intent);}
    // New chat/call notification opens the intended screen only after normal account verification.
    private void handleNotificationIntent(Intent intent){
        if(intent==null)return;
        if(intent.getBooleanExtra("open_incoming",false)){
            if(web!=null&&web.getUrl()!=null&&trusted(Uri.parse(web.getUrl())))web.evaluateJavascript("window.ChatXEnterFromNotification?.();",null);
            else openIncomingAfterLoad=true;
        }
        String peer=intent.getStringExtra("open_peer");
        if(peer!=null&&peer.matches("[0-9a-fA-F-]{36}")){
            if(web!=null&&web.getUrl()!=null&&trusted(Uri.parse(web.getUrl())))web.evaluateJavascript("window.ChatXOpenPeerFromNotification?.('"+peer+"');",null);
            else openPeerAfterLoad=peer;
        }
    }
    @Override protected void onPause(){super.onPause();if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('chatx-background'));",null);}
    @Override protected void onResume(){super.onResume();if(web!=null){web.evaluateJavascript("window.dispatchEvent(new Event('chatx-foreground'));",null);notifyConnectState();}}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
}
