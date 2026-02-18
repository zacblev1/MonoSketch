plugins {
    kotlin("js")
    kotlin("plugin.serialization")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(projects.commons)
    implementation(projects.graphicsgeo)
    implementation(projects.livedata)
    implementation(projects.lifecycle)
    implementation(projects.monobitmap)
    implementation(projects.monobitmapManager)
    implementation(projects.monoboard)
    implementation(projects.shape)
    implementation(projects.shapeSerialization)
    implementation(projects.uuid)
    implementation(projects.buildEnvironment)

    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.kotlin.test.js)
}

val compilerType: org.jetbrains.kotlin.gradle.plugin.KotlinJsCompilerType by ext
kotlin {
    js(compilerType) {
        nodejs {}
        binaries.library()
    }
}
