allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

subprojects {
    project.evaluationDependsOn(":app")
}

// Plugin subprojects (tflite_flutter, fllama, camera, ...) declare varying
// Java/Kotlin targets. Force BOTH javac and kotlinc to JVM 17 so they stay
// consistent — forcing only Kotlin causes "Inconsistent JVM Target
// Compatibility" failures against plugins whose Java target is 11.
subprojects {
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
    // Configure the android extension itself: AGP derives the javac tasks'
    // source/target from compileOptions, so task-level overrides don't stick.
    // Must run after the plugin's own build.gradle (which sets Java 11) has
    // evaluated; some subprojects are already evaluated at this point because
    // of evaluationDependsOn(":app") above, so handle both cases.
    fun alignJavaTarget(p: Project) {
        p.extensions.findByType(com.android.build.api.dsl.LibraryExtension::class.java)?.apply {
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
        }
    }
    if (state.executed) {
        alignJavaTarget(this)
    } else {
        afterEvaluate { alignJavaTarget(this) }
    }
}


tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
