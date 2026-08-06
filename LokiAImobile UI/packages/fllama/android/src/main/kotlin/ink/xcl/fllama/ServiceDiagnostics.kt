package ink.xcl.fllama

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import org.json.JSONObject

/**
 * Classification of why the isolated `:inference` process stopped.
 *
 * The old code reported one opaque code — `SERVICE_DISCONNECTED`, with a null
 * details field — for every possible cause, and the Dart layer then relabelled
 * that as `CHAT_CONTEXT_CREATE_FAILED` and told the user to redeploy the
 * model. A service that Android killed to reclaim memory is not an
 * incompatible model, and redeploying identical bytes cannot fix it.
 *
 * Every code here describes the SERVICE. None of them may ever be mapped onto
 * a model-artifact failure code.
 */
enum class ServiceFailureCode(val wire: String) {
    DISCONNECTED("INFERENCE_SERVICE_DISCONNECTED"),
    BIND_FAILED("INFERENCE_SERVICE_BIND_FAILED"),
    DIED("INFERENCE_SERVICE_DIED"),
    BINDER_DIED("INFERENCE_SERVICE_BINDER_DIED"),
    START_FAILED("INFERENCE_SERVICE_START_FAILED"),
    REBIND_EXHAUSTED("INFERENCE_SERVICE_REBIND_EXHAUSTED"),
    LOW_MEMORY_KILL("INFERENCE_SERVICE_LOW_MEMORY_KILL"),
    NATIVE_CRASH("INFERENCE_SERVICE_NATIVE_CRASH"),
    JVM_CRASH("INFERENCE_SERVICE_JVM_CRASH"),
    UNKNOWN_EXIT("INFERENCE_SERVICE_UNKNOWN_EXIT"),
}

/** Lifecycle of the binding to [FllamaService]. Serializes bind attempts. */
enum class ServiceConnectionState {
    UNBOUND, BINDING, BOUND, DISCONNECTED, DEAD, REBINDING, FAILED, DISPOSED,
}

/** What the runtime was doing when the service went away. */
enum class ServiceOperationPhase(val wire: String) {
    IDLE("idle"),
    LOAD("load"),
    GENERATION("generation"),
    CANCELLATION("cancellation"),
    DISPOSAL("disposal"),
}

/**
 * Reads Android's own record of why a process died.
 *
 * This is the ONLY source that can distinguish a low-memory kill from a
 * native crash from a clean exit. Where it is unavailable (API < 30) or has
 * no matching record, the result stays [ServiceFailureCode.UNKNOWN_EXIT] —
 * deliberately. Guessing "probably OOM" is what this class exists to prevent.
 */
object ServiceExitInspector {

    /** Exit evidence for the inference process, or null when none is available. */
    fun inspect(context: Context, processSuffix: String = ":inference"): ExitEvidence? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return null
            val records = am.getHistoricalProcessExitReasons(context.packageName, 0, 10)
            val match = records.firstOrNull { it.processName.endsWith(processSuffix) }
                ?: return null
            ExitEvidence(
                code = classify(match),
                reason = match.reason,
                reasonName = reasonName(match.reason),
                status = match.status,
                importance = match.importance,
                timestamp = match.timestamp,
                processName = match.processName,
                description = match.description,
                pssKb = match.pss,
                rssKb = match.rss,
                traceAvailable = runCatching { match.traceInputStream != null }.getOrDefault(false),
            )
        } catch (e: Exception) {
            FLog.w("ServiceExitInspector failed: ${e.message}")
            null
        }
    }

    fun classify(info: ApplicationExitInfo): ServiceFailureCode =
        classifyReason(info.reason)

    /**
     * Deterministic mapping from Android's reason constant to our code.
     * Only evidence-supported reasons are mapped; everything else stays
     * UNKNOWN_EXIT rather than being folded into a plausible-sounding bucket.
     *
     * Takes the raw Int rather than an ApplicationExitInfo so the mapping is
     * a pure function that can be unit-tested off-device — the constants are
     * compile-time `static final int`s and inline into the test.
     */
    fun classifyReason(reason: Int): ServiceFailureCode = when (reason) {
        ApplicationExitInfo.REASON_LOW_MEMORY -> ServiceFailureCode.LOW_MEMORY_KILL
        ApplicationExitInfo.REASON_CRASH_NATIVE -> ServiceFailureCode.NATIVE_CRASH
        ApplicationExitInfo.REASON_CRASH -> ServiceFailureCode.JVM_CRASH
        ApplicationExitInfo.REASON_ANR -> ServiceFailureCode.DIED
        ApplicationExitInfo.REASON_SIGNALED -> ServiceFailureCode.NATIVE_CRASH
        // A user-requested stop, an app update, a device reboot, an explicit
        // exit or a permission change are NOT service faults and are never
        // attributable to a model. They stay UNKNOWN_EXIT here and are
        // filtered out of strike attribution on the Dart side.
        else -> ServiceFailureCode.UNKNOWN_EXIT
    }

    fun reasonName(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_UNKNOWN -> "UNKNOWN"
        ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
        ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
        ApplicationExitInfo.REASON_CRASH -> "CRASH"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
        ApplicationExitInfo.REASON_ANR -> "ANR"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
        ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
        ApplicationExitInfo.REASON_OTHER -> "OTHER"
        else -> "REASON_$reason"
    }

    /** Current memory state, for context at the moment of failure. */
    fun memoryState(context: Context): JSONObject {
        val out = JSONObject()
        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return out
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            out.put("total_mb", mi.totalMem / (1024 * 1024))
            out.put("available_mb", mi.availMem / (1024 * 1024))
            out.put("threshold_mb", mi.threshold / (1024 * 1024))
            out.put("system_low_memory", mi.lowMemory)
        } catch (e: Exception) {
            out.put("memory_state_error", e.javaClass.simpleName)
        }
        return out
    }
}

data class ExitEvidence(
    val code: ServiceFailureCode,
    val reason: Int,
    val reasonName: String,
    val status: Int,
    val importance: Int,
    val timestamp: Long,
    val processName: String,
    val description: String?,
    val pssKb: Long,
    val rssKb: Long,
    val traceAvailable: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("classified_code", code.wire)
        .put("reason", reason)
        .put("reason_name", reasonName)
        .put("status", status)
        .put("importance", importance)
        .put("timestamp", timestamp)
        .put("process_name", processName)
        .put("description", description ?: JSONObject.NULL)
        .put("pss_kb", pssKb)
        .put("rss_kb", rssKb)
        .put("trace_available", traceAvailable)
}

/**
 * Structured diagnostics attached to every service failure, replacing the
 * `details = null` that made `SERVICE_DISCONNECTED` unactionable.
 *
 * Deliberately carries no absolute filesystem paths: the model is identified
 * by a short salted fingerprint of its basename only.
 */
object ServiceDiagnostics {

    fun build(
        componentName: String?,
        state: ServiceConnectionState,
        bindingCompleted: Boolean,
        requestActive: Boolean,
        operation: ServiceOperationPhase,
        activeRequestId: Int?,
        modelFingerprint: String?,
        rebindAttempts: Int,
        sessionGeneration: Int,
        exit: ExitEvidence?,
        memory: JSONObject?,
    ): String {
        val json = JSONObject()
            .put("component_name", componentName ?: JSONObject.NULL)
            .put("service_state", state.name.lowercase())
            .put("binding_completed", bindingCompleted)
            .put("request_active", requestActive)
            .put("active_operation", operation.wire)
            .put("active_request_id", activeRequestId ?: JSONObject.NULL)
            .put("model_fingerprint", modelFingerprint ?: JSONObject.NULL)
            .put("rebind_attempts", rebindAttempts)
            .put("session_generation", sessionGeneration)
            .put("timestamp_ms", System.currentTimeMillis())
            .put("sdk_int", Build.VERSION.SDK_INT)
            .put("exit_info_supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
        json.put("exit_evidence", exit?.toJson() ?: JSONObject.NULL)
        json.put("memory_state", memory ?: JSONObject.NULL)
        return json.toString()
    }

    /**
     * Short, non-reversible identifier for a model file. Uses the basename
     * only, so no private absolute path can leak into telemetry or a UI
     * error string.
     */
    fun fingerprint(modelPath: String?): String? {
        if (modelPath.isNullOrEmpty()) return null
        val base = modelPath.substringAfterLast('/').substringAfterLast('\\')
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(base.toByteArray())
        return digest.take(8).joinToString("") { "%02x".format(it) }
    }
}
