pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    plugins { id("com.android.application") version "9.4.1" }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google(); mavenCentral()
        maven("https://juanofteamsketch2react.github.io/forever-machines-sdk/maven")
    }
}
rootProject.name = "SleepDemo"
include(":app")
