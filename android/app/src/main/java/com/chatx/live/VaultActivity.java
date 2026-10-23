package com.chatx.live;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.content.Intent;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.MediaStore;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.text.InputType;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Local password-encrypted video/photo vault. No image/video content is sent to the ChatX server.
 * Import -> verify encrypted copy -> ask the user to confirm deletion of original.
 * Source deletion is provider/OS controlled and is NEVER assumed to succeed.
 * Restore -> write back to gallery -> only then remove encrypted copy.
 * Files remain inside the app private directory; uninstall/app-data-clear removes them.
 */
public final class VaultActivity extends Activity {
    private static final int PICK_MEDIA=5001, RESTORE_OLD=5002;
    private final SecureRandom random=new SecureRandom();
    private final int purple=Color.rgb(148,78,229), white=Color.rgb(245,231,255);
    private LinearLayout root,recordsBox;
    private EditText passBox;
    private TextView status;
    private byte[] vaultKey;
    private String restoreId;
    private final java.util.List<JSONObject> records=new java.util.ArrayList<>();
    private SharedPreferences prefs;
    private File storeDir;

    @Override public void onCreate(Bundle state){super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(22,12,39));getWindow().setNavigationBarColor(Color.rgb(22,12,39));
        prefs=getSharedPreferences("vault_state_v1",MODE_PRIVATE);
        storeDir=new File(getFilesDir(),"encrypted-vault");if(!storeDir.exists())storeDir.mkdirs();
        loadRecords();renderLocked();
    }
    private byte[] randomBytes(int n){byte[] b=new byte[n];random.nextBytes(b);return b;}
    private String b64(byte[] b){return Base64.encodeToString(b,Base64.NO_WRAP);}
    private byte[] unb64(String s){return Base64.decode(s,Base64.DEFAULT);}
    private byte[] derive(String password,byte[] salt)throws Exception{
        PBEKeySpec p=new PBEKeySpec(password.toCharArray(),salt,250000,256);
        try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(p).getEncoded();}
        finally{p.clearPassword();}
    }
    private byte[] verifier(byte[] key)throws Exception{
        MessageDigest d=MessageDigest.getInstance("SHA-256");d.update(key);return d.digest("ChatX Native Vault Check v1".getBytes(StandardCharsets.UTF_8));
    }
    private void status(String msg){runOnUiThread(()->{if(status!=null)status.setText(msg);});}
    private LinearLayout column(){LinearLayout x=new LinearLayout(this);x.setOrientation(LinearLayout.VERTICAL);x.setPadding(22,24,22,26);x.setBackgroundColor(Color.rgb(22,12,39));return x;}
    private TextView text(String msg,int size){TextView t=new TextView(this);t.setText(msg);t.setTextSize(size);t.setTextColor(white);t.setPadding(0,9,0,10);return t;}
    private Button button(String name){Button b=new Button(this);b.setText(name);b.setTextColor(white);b.setAllCaps(false);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(purple));return b;}
    private void renderLocked(){vaultKey=null;root=column();ScrollView scroll=new ScrollView(this);scroll.addView(root);setContentView(scroll);
        TextView title=text("🔒 ChatX · Private Vault",24);title.setTypeface(null,Typeface.BOLD);root.addView(title);
        root.addView(text("Photos & videos encrypted on this device. Original media can be removed only with Android's approval. Uninstall/app data reset will erase this vault.",13));
        passBox=new EditText(this);passBox.setSingleLine(true);passBox.setHint("Vault password (8+ characters)");passBox.setTextColor(white);passBox.setHintTextColor(Color.LTGRAY);passBox.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);root.addView(passBox);
        Button open=button(prefs.contains("salt")?"Unlock Vault":"Create Vault");root.addView(open);
        status=text("",13);root.addView(status);
        open.setOnClickListener(v->{String pass=passBox.getText().toString();if(pass.length()<8){status("Password must be at least 8 characters");return;}
            open.setEnabled(false);status("Deriving encryption key…");new Thread(()->{
                try{
                    byte[] salt=prefs.contains("salt")?unb64(prefs.getString("salt","")):randomBytes(24);
                    byte[] key=derive(pass,salt);
                    String check=b64(verifier(key));
                    if(prefs.contains("verifier")&&!MessageDigest.isEqual(unb64(prefs.getString("verifier","")),unb64(check)))throw new Exception("Incorrect vault password");
                    if(!prefs.contains("salt"))prefs.edit().putString("salt",b64(salt)).putString("verifier",check).apply();
                    vaultKey=key;runOnUiThread(this::renderOpen);
                }catch(Exception ex){status(ex.getMessage());runOnUiThread(()->open.setEnabled(true));}
            }).start();
        });
    }
    private void renderOpen(){if(vaultKey==null){renderLocked();return;}
        root=column();ScrollView scroll=new ScrollView(this);scroll.addView(root);setContentView(scroll);
        TextView title=text("🔐 Private Media Vault",24);title.setTypeface(null,Typeface.BOLD);root.addView(title);
        root.addView(text("Media is encrypted locally. Hide = encrypt, verify, then request your permission to remove the original. If the original cannot be removed, Gallery keeps it.",13));
        Button choose=button("＋ Hide photos / videos");root.addView(choose);choose.setOnClickListener(v->pick());
        Button lock=button("Lock Now");root.addView(lock);lock.setOnClickListener(v->renderLocked());
        status=text("",13);root.addView(status);recordsBox=new LinearLayout(this);recordsBox.setOrientation(LinearLayout.VERTICAL);root.addView(recordsBox);
        showRecords();
    }
    private void loadRecords(){records.clear();try{JSONArray arr=new JSONArray(prefs.getString("items","[]"));for(int i=0;i<arr.length();i++)records.add(arr.getJSONObject(i));}catch(Exception ignored){} }
    private void saveRecords(){JSONArray arr=new JSONArray();for(JSONObject o:records)arr.put(o);prefs.edit().putString("items",arr.toString()).apply();}
    private JSONObject find(String id){for(JSONObject r:records)if(id.equals(r.optString("id")))return r;return null;}
    private void showRecords(){recordsBox.removeAllViews();if(records.isEmpty()){recordsBox.addView(text("No hidden media yet",15));return;}
        for(JSONObject r:new java.util.ArrayList<>(records)){
            String id=r.optString("id"),name=r.optString("name"),mime=r.optString("mime"), state=r.optBoolean("removed",false)?"Hidden from gallery":"Vault copy safe · Original may remain in Gallery";
            recordsBox.addView(text((mime.startsWith("video/")?"🎞 ":"🖼 ")+name+"\n"+state,15));
            Button restore=button("Unhide → Restore to Gallery");recordsBox.addView(restore);restore.setOnClickListener(v->restore(id));
            if(!r.optBoolean("removed",false)){
                Button remove=button("Remove original (Android approval)");recordsBox.addView(remove);remove.setOnClickListener(v->requestOriginalDelete(id));
            }
            Button delete=button("Delete encrypted Vault copy");recordsBox.addView(delete);
            delete.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("Delete Vault Copy?").setMessage("This deletes the encrypted copy. If the original was removed, the media cannot be recovered!").setNegativeButton("Cancel",null).setPositiveButton("Delete",(d,w)->removeEntry(id)).show());
            View space=new View(this);space.setMinimumHeight(20);recordsBox.addView(space);
        }
    }
    private void pick(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","video/*"});i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(i,PICK_MEDIA);}
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();if(req==PICK_MEDIA){
            try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){
                try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignoredAgain){}
            }
            status("Encrypting selected file…");new Thread(()->importMedia(uri)).start();
        }else if(req==RESTORE_OLD&&restoreId!=null){String id=restoreId;restoreId=null;status("Restoring…");new Thread(()->restoreFile(id,uri)).start();}
    }
    private String mediaName(Uri uri){try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
        if(c!=null&&c.moveToFirst())return c.getString(0);
    }catch(Exception ignored){}return "PrivateMedia";}
    private void importMedia(Uri uri){File out=null;try{
        if(vaultKey==null)throw new Exception("Unlock Vault first");
        String mime=getContentResolver().getType(uri);if(mime==null||!(mime.startsWith("image/")||mime.startsWith("video/")))throw new Exception("Only photos and videos supported");
        String name=mediaName(uri),id=UUID.randomUUID().toString();out=new File(storeDir,id+".enc");
        byte[] iv=randomBytes(12);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(vaultKey,"AES"),new GCMParameterSpec(128,iv));
        MessageDigest sourceDigest=MessageDigest.getInstance("SHA-256");long size=0;
        try(InputStream in=getContentResolver().openInputStream(uri);FileOutputStream fos=new FileOutputStream(out)){
            if(in==null)throw new Exception("Gallery file cannot be opened");fos.write(iv);
            try(CipherOutputStream encrypted=new CipherOutputStream(fos,cipher)){byte[] buf=new byte[65536];int n;
                while((n=in.read(buf))!=-1){encrypted.write(buf,0,n);sourceDigest.update(buf,0,n);size+=n;if(size>500L*1024*1024)throw new Exception("File exceeds 500 MB limit");}
            }
        }
        // Round-trip integrity: decrypt written bytes, hash, compare to original.
        MessageDigest verified=MessageDigest.getInstance("SHA-256");byte[] header=new byte[12];
        try(FileInputStream fis=new FileInputStream(out)){
            if(fis.read(header)!=12)throw new Exception("Encrypted file corrupt");Cipher dec=Cipher.getInstance("AES/GCM/NoPadding");dec.init(Cipher.DECRYPT_MODE,new SecretKeySpec(vaultKey,"AES"),new GCMParameterSpec(128,header));
            try(CipherInputStream plain=new CipherInputStream(fis,dec)){byte[] buf=new byte[65536];int n;while((n=plain.read(buf))!=-1)verified.update(buf,0,n);}
        }
        if(!MessageDigest.isEqual(sourceDigest.digest(),verified.digest()))throw new Exception("Integrity verification failed");
        JSONObject item=new JSONObject();item.put("id",id);item.put("name",name);item.put("mime",mime);item.put("originalUri",uri.toString());item.put("removed",false);item.put("bytes",size);
        records.add(item);saveRecords();runOnUiThread(()->{showRecords();status("Encrypted and verified. Approve source deletion to hide it from Gallery.");requestOriginalDelete(id);});
    }catch(Exception e){if(out!=null)out.delete();status("Import failed; original unchanged: "+e.getMessage());}}
    private void requestOriginalDelete(String id){JSONObject item=find(id);if(item==null)return;
        new AlertDialog.Builder(this).setTitle("Remove original from Gallery?")
          .setMessage("The encrypted Vault copy was checked. Android will request permission to remove the original. Cancel keeps the original in Gallery.")
          .setNegativeButton("Keep original",(d,w)->status("Vault copy saved; original left in Gallery"))
          .setPositiveButton("Request removal",(d,w)->removeOriginal(id)).show();
    }
    private void removeOriginal(String id){JSONObject item=find(id);if(item==null)return;
        Uri uri=Uri.parse(item.optString("originalUri"));try{
            if(!DocumentsContract.isDocumentUri(this,uri))throw new Exception("Gallery provider cannot remove original automatically");
            boolean deleted=DocumentsContract.deleteDocument(getContentResolver(),uri);
            if(!deleted)throw new Exception("Android did not confirm deletion");
            item.put("removed",true);saveRecords();showRecords();status("Original removed. Encrypted copy remains in Vault.");
        }catch(Exception e){status("Original still in Gallery. Delete with the system Gallery app if needed. Reason: "+e.getMessage());}
    }
    private void restore(String id){JSONObject item=find(id);if(item==null||vaultKey==null)return;
        if(Build.VERSION.SDK_INT>=29){status("Restoring to Gallery…");new Thread(()->restoreFile(id,null)).start();}
        else{restoreId=id;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(item.optString("mime","application/octet-stream"));i.putExtra(Intent.EXTRA_TITLE,item.optString("name","Restored"));startActivityForResult(i,RESTORE_OLD);}
    }
    private void restoreFile(String id,Uri chosen){JSONObject item=find(id);if(item==null)return;Uri output=chosen;
        try{
            if(output==null){String mime=item.optString("mime","image/jpeg");boolean video=mime.startsWith("video/");ContentValues cv=new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME,item.optString("name","RestoredMedia"));cv.put(MediaStore.MediaColumns.MIME_TYPE,mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH,(video?Environment.DIRECTORY_MOVIES:Environment.DIRECTORY_PICTURES)+"/ChatX Restored");
                cv.put(MediaStore.MediaColumns.IS_PENDING,1);
                output=getContentResolver().insert(video?MediaStore.Video.Media.EXTERNAL_CONTENT_URI:MediaStore.Images.Media.EXTERNAL_CONTENT_URI,cv);
            }
            if(output==null)throw new Exception("Gallery restore URI was not created");
            File f=new File(storeDir,id+".enc");byte[] iv=new byte[12];
            try(FileInputStream fis=new FileInputStream(f)){
                if(fis.read(iv)!=12)throw new Exception("Encrypted data unavailable");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(vaultKey,"AES"),new GCMParameterSpec(128,iv));
                try(CipherInputStream in=new CipherInputStream(fis,c);OutputStream out=getContentResolver().openOutputStream(output,"w")){
                    if(out==null)throw new Exception("Cannot write Gallery file");byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);out.flush();
                }
            }
            if(Build.VERSION.SDK_INT>=29&&chosen==null){ContentValues v=new ContentValues();v.put(MediaStore.MediaColumns.IS_PENDING,0);getContentResolver().update(output,v,null,null);}
            f.delete();records.remove(item);saveRecords();runOnUiThread(()->{showRecords();status("Unhidden successfully: media restored to Gallery");});
        }catch(Exception e){if(output!=null&&chosen==null)try{getContentResolver().delete(output,null,null);}catch(Exception ignored){}status("Restore failed; encrypted Vault copy retained: "+e.getMessage());}
    }
    private void removeEntry(String id){JSONObject item=find(id);if(item==null)return;
        File f=new File(storeDir,id+".enc");if(f.exists()&&!f.delete()){status("Could not delete encrypted file");return;}
        records.remove(item);saveRecords();showRecords();status("Encrypted copy removed");
    }
    @Override protected void onDestroy(){if(vaultKey!=null)java.util.Arrays.fill(vaultKey,(byte)0);vaultKey=null;super.onDestroy();}
}
