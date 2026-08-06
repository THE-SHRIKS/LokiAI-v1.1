package ink.xcl.fllama

import android.app.ApplicationExitInfo
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Test 19 of the P0 incident plan: ApplicationExitInfo mappings must be
 * deterministic, and an exit Android does not explain must never be reported
 * as a low-memory kill.
 *
 * Runs off-device: [ServiceExitInspector.classifyReason] is a pure function
 * over Android's compile-time constants.
 */
class ServiceExitInspectorTest {

    @Test
    fun `low memory maps to a low memory kill`() {
        assertEquals(
            ServiceFailureCode.LOW_MEMORY_KILL,
            ServiceExitInspector.classifyReason(ApplicationExitInfo.REASON_LOW_MEMORY),
        )
    }

    @Test
    fun `native crash maps to a native crash`() {
        assertEquals(
            ServiceFailureCode.NATIVE_CRASH,
            ServiceExitInspector.classifyReason(ApplicationExitInfo.REASON_CRASH_NATIVE),
        )
        assertEquals(
            ServiceFailureCode.NATIVE_CRASH,
            ServiceExitInspector.classifyReason(ApplicationExitInfo.REASON_SIGNALED),
        )
    }

    @Test
    fun `jvm crash maps to a jvm crash`() {
        assertEquals(
            ServiceFailureCode.JVM_CRASH,
            ServiceExitInspector.classifyReason(ApplicationExitInfo.REASON_CRASH),
        )
    }

    /**
     * The core anti-guessing guarantee. Everything Android does not
     * explicitly attribute stays UNKNOWN — none of these may become OOM.
     */
    @Test
    fun `unexplained and benign exits stay unknown, never low memory`() {
        val unexplained = listOf(
            ApplicationExitInfo.REASON_UNKNOWN,
            ApplicationExitInfo.REASON_EXIT_SELF,
            ApplicationExitInfo.REASON_OTHER,
            ApplicationExitInfo.REASON_USER_REQUESTED,
            ApplicationExitInfo.REASON_USER_STOPPED,
            ApplicationExitInfo.REASON_DEPENDENCY_DIED,
            ApplicationExitInfo.REASON_PERMISSION_CHANGE,
            ApplicationExitInfo.REASON_INITIALIZATION_FAILURE,
            ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
            9999,
        )
        for (reason in unexplained) {
            val code = ServiceExitInspector.classifyReason(reason)
            assertEquals(
                "reason $reason must stay UNKNOWN_EXIT",
                ServiceFailureCode.UNKNOWN_EXIT,
                code,
            )
            assertFalse(
                "reason $reason must never be classified as a memory kill",
                code == ServiceFailureCode.LOW_MEMORY_KILL,
            )
        }
    }

    @Test
    fun `classification is deterministic across repeated calls`() {
        val reasons = listOf(
            ApplicationExitInfo.REASON_LOW_MEMORY,
            ApplicationExitInfo.REASON_CRASH,
            ApplicationExitInfo.REASON_CRASH_NATIVE,
            ApplicationExitInfo.REASON_ANR,
            ApplicationExitInfo.REASON_UNKNOWN,
        )
        for (reason in reasons) {
            val first = ServiceExitInspector.classifyReason(reason)
            repeat(20) {
                assertEquals(first, ServiceExitInspector.classifyReason(reason))
            }
        }
    }

    @Test
    fun `every reason constant has a stable name`() {
        assertEquals("LOW_MEMORY",
            ServiceExitInspector.reasonName(ApplicationExitInfo.REASON_LOW_MEMORY))
        assertEquals("CRASH_NATIVE",
            ServiceExitInspector.reasonName(ApplicationExitInfo.REASON_CRASH_NATIVE))
        assertEquals("REASON_9999", ServiceExitInspector.reasonName(9999))
    }
}

/**
 * Test 14: a service failure must carry structured diagnostics, replacing
 * the `details = null` that made SERVICE_DISCONNECTED unclassifiable.
 */
class ServiceDiagnosticsTest {

    private fun build(exit: ExitEvidence? = null): JSONObject = JSONObject(
        ServiceDiagnostics.build(
            componentName = "io.lokiai.lokiai_app/ink.xcl.fllama.FllamaService",
            state = ServiceConnectionState.DISCONNECTED,
            bindingCompleted = true,
            requestActive = true,
            operation = ServiceOperationPhase.LOAD,
            activeRequestId = 42,
            modelFingerprint = ServiceDiagnostics.fingerprint("/data/user/0/x/model.gguf"),
            rebindAttempts = 2,
            sessionGeneration = 3,
            exit = exit,
            memory = JSONObject().put("available_mb", 512).put("system_low_memory", true),
        )
    )

    @Test
    fun `diagnostics contain every required field`() {
        val json = build()
        for (field in listOf(
            "component_name", "service_state", "binding_completed",
            "request_active", "active_operation", "active_request_id",
            "model_fingerprint", "rebind_attempts", "session_generation",
            "timestamp_ms", "sdk_int", "exit_info_supported",
        )) {
            assertTrue("missing $field", json.has(field))
        }
        assertEquals("disconnected", json.getString("service_state"))
        assertEquals("load", json.getString("active_operation"))
        assertEquals(42, json.getInt("active_request_id"))
        assertEquals(2, json.getInt("rebind_attempts"))
    }

    @Test
    fun `diagnostics never contain an absolute filesystem path`() {
        val raw = build().toString()
        assertFalse(raw.contains("/data/user/"))
        assertFalse(raw.contains("model.gguf"))
    }

    @Test
    fun `model fingerprint is stable, short and path-free`() {
        val a = ServiceDiagnostics.fingerprint("/data/user/0/io.lokiai/files/m.gguf")
        val b = ServiceDiagnostics.fingerprint("/storage/emulated/0/other/m.gguf")
        // Same basename, different directories -> same fingerprint: the
        // fingerprint identifies the artifact, not where it happens to live.
        assertEquals(a, b)
        assertEquals(16, a!!.length)
        assertFalse(a.contains("/"))
        assertNull(ServiceDiagnostics.fingerprint(null))
        assertNull(ServiceDiagnostics.fingerprint(""))
    }

    @Test
    fun `exit evidence is embedded when available`() {
        val evidence = ExitEvidence(
            code = ServiceFailureCode.LOW_MEMORY_KILL,
            reason = ApplicationExitInfo.REASON_LOW_MEMORY,
            reasonName = "LOW_MEMORY",
            status = 0,
            importance = 100,
            timestamp = 1_700_000_000_000L,
            processName = "io.lokiai.lokiai_app:inference",
            description = "isolated process killed",
            pssKb = 1_048_576,
            rssKb = 2_097_152,
            traceAvailable = false,
        )
        val json = build(evidence)
        val exit = json.getJSONObject("exit_evidence")
        assertNotNull(exit)
        assertEquals("INFERENCE_SERVICE_LOW_MEMORY_KILL",
            exit.getString("classified_code"))
        assertEquals("LOW_MEMORY", exit.getString("reason_name"))
        assertEquals(1_048_576L, exit.getLong("pss_kb"))
        assertTrue(exit.getString("process_name").endsWith(":inference"))
    }

    @Test
    fun `all ten service codes have distinct wire values`() {
        val wires = ServiceFailureCode.values().map { it.wire }
        assertEquals(10, wires.size)
        assertEquals(wires.size, wires.toSet().size)
        // None may collide with a model-artifact failure code.
        assertFalse(wires.contains("CHAT_CONTEXT_CREATE_FAILED"))
        assertTrue(wires.all { it.startsWith("INFERENCE_SERVICE_") })
    }
}
