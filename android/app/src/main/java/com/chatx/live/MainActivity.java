package com.chatx.live;

import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
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
    private PermissionRequest pendingAudio;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private static final int PICK_IMAGE = 202;
    private static final int AUDIO_PERMISSION = 203;
    private static final int LOCATION_PERMISSION = 204;

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
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u=request.getUrl();
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
                    if(!trusted(req.getOrigin())){req.deny();return;}
                    boolean audioRequested=false;
                    for(String r:req.getResources()) if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audioRequested=true;
                    if(!audioRequested){req.deny();return;}
                    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
                        req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else { pendingAudio=req;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},AUDIO_PERMISSION); }
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
        web.loadUrl(BuildConfig.CHATX_URL);
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        boolean ok=false;for(int g:grants)if(g==PackageManager.PERMISSION_GRANTED)ok=true;
        if(requestCode==AUDIO_PERMISSION && pendingAudio!=null){
            if(ok)pendingAudio.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else pendingAudio.deny();pendingAudio=null;
        }
        if(requestCode==LOCATION_PERMISSION && pendingGeo!=null){pendingGeo.invoke(pendingGeoOrigin,ok,false);pendingGeo=null;pendingGeoOrigin=null;}
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_IMAGE && fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}
    }
    @Override protected void onPause(){super.onPause();if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('chatx-background'));",null);}
    @Override protected void onResume(){super.onResume();if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('chatx-foreground'));",null);}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
}
