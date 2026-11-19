plugins { id("com.android.application") }
android {
    namespace = "net.forevermachines.demo"
    compileSdk = 35
    defaultConfig { applicationId = "net.forevermachines.demo"; minSdk = 26; targetSdk = 35; versionCode = 3; versionName = "0.3.2" }
    buildTypes { release { signingConfig = signingConfigs.getByName("debug") } }   // (a demo to sideload: signed with the debug key, not for a store)
}
dependencies { implementation("net.forevermachines:sdk:0.3.2") }
