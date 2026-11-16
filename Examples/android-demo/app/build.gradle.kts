plugins { id("com.android.application") }
android {
    namespace = "net.forevermachines.demo"
    compileSdk = 35
    defaultConfig { applicationId = "net.forevermachines.demo"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0" }
}
dependencies { implementation("net.forevermachines:sdk:0.2.2") }
