plugins { id("com.android.application") }
android {
    namespace = "net.forevermachines.demo"
    compileSdk = 35
    defaultConfig { applicationId = "net.forevermachines.demo"; minSdk = 26; targetSdk = 35; versionCode = 8; versionName = "0.4.4" }
    buildTypes { release { signingConfig = signingConfigs.getByName("debug") } }   // (a demo to sideload: signed with the debug key, not for a store)
}
dependencies { implementation("net.forevermachines:sdk:0.4.5") }
