plugins { id("com.android.application") }
android { namespace = "com.chatx.live"; compileSdk = 35
  defaultConfig { applicationId = "com.chatx.live"; minSdk = 26; targetSdk = 35; versionCode = 3; versionName = "3.0";
    val site = providers.gradleProperty("chatxUrl").orElse("https://example.invalid/").get()
    buildConfigField("String", "CHATX_URL", "\"${site.trimEnd('/')}/\"") }
  buildFeatures { buildConfig = true }
}
