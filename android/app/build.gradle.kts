plugins { id("com.android.application") }
android { namespace = "com.chatx.live"; compileSdk = 35
  defaultConfig { applicationId = "com.chatx.live"; minSdk = 26; targetSdk = 35; versionCode = 6; versionName = "6.0";
    val site = providers.gradleProperty("chatxUrl").orElse("https://example.invalid/").get()
    buildConfigField("String", "CHATX_URL", "\"${site.trimEnd('/')}/\"")
    fun firebaseField(key: String, gradleKey: String) {
      val v = providers.gradleProperty(gradleKey).orElse("").get()
      buildConfigField("String", key, "\"${v}\"")
    }
    firebaseField("FIREBASE_APP_ID", "firebaseAppId")
    firebaseField("FIREBASE_API_KEY", "firebaseApiKey")
    firebaseField("FIREBASE_PROJECT_ID", "firebaseProjectId")
    firebaseField("FIREBASE_SENDER_ID", "firebaseSenderId") }
  buildFeatures { buildConfig = true }
}

dependencies { implementation("com.google.firebase:firebase-messaging:24.1.2") }
