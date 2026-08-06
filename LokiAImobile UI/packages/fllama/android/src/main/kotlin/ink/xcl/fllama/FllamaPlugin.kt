package ink.xcl.fllama

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result
import java.io.Serializable
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min
import kotlin.random.Random

/**
 * FllamaPlugin
 *
 * Owns an explicit connection state machine for the isolated `:inference`
 * service. Previously the plugin had two booleans (`bound`,
 * `rebindAttemptedAfterDeath`), rebound from `onMethodCall` on every call
 * while unbound, and failed every pending request with
 * `SERVICE_DISCONNECTED` and a null details field — leaving the Dart layer
 * with nothing to classify and no way to tell a memory kill from a crash.
 */
class FllamaPlugin : FlutterPlugin, MethodCallHandler, ActivityAware, EventChannel.StreamHandler {
    private lateinit var channel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private var context: Context? = null
    private var activity: Activity? = null
    private var serviceMessenger: Messenger? = null
    private var lastComponentName: String? = null

    // --- connection state machine -----------------------------------------
    private var state: ServiceConnectionState = ServiceConnectionState.UNBOUND
    private var rebindAttempts = 0
    private var sessionGeneration = 0
    private var connectionRegistered = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var scheduledRebind: Runnable? = null

    // --- active work tracking, for diagnostics -----------------------------
    private var activeOperation: ServiceOperationPhase = ServiceOperationPhase.IDLE
    private var activeModelFingerprint: String? = null

    private val requestIds = AtomicInteger(1)
    private val pendingResults = LinkedHashMap<Int, PendingRequest>()
    private val methodCallQueue = mutableListOf<Pair<MethodCall, Result>>()

    private data class PendingRequest(
        val result: Result,
        val method: String,
        val generation: Int,
    )

    private companion object {
        const val MAX_REBIND_ATTEMPTS = 4
        const val BASE_BACKOFF_MS = 400L
        const val MAX_BACKOFF_MS = 8_000L
        // A connection must survive this long before its retry budget is
        // considered recovered. Resetting on onServiceConnected alone let a
        // service that died immediately after binding retry forever.
        const val STABLE_CONNECTION_MS = 5_000L
    }

    private val incomingMessenger = Messenger(
        object : Handler(Looper.getMainLooper()) {
            override fun handleMessage(msg: Message) {
                when (msg.what) {
                    FllamaIpc.MSG_RESPONSE -> handleServiceResponse(msg.data)
                    FllamaIpc.MSG_EVENT -> handleServiceEvent(msg.data)
                    else -> super.handleMessage(msg)
                }
            }
        }
    )

    private val deathRecipient = IBinder.DeathRecipient {
        mainHandler.post {
            FLog.w("FllamaPlugin inference service binder died")
            serviceMessenger = null
            transitionTo(ServiceConnectionState.DEAD)
            // Binder death and onServiceDisconnected both fire for a process
            // death. failPending() is idempotent per request, so whichever
            // arrives first reports it and the second is a no-op — a request
            // is failed exactly once.
            failPending(ServiceFailureCode.BINDER_DIED)
            scheduleRebind()
        }
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            FLog.d("FllamaPlugin serviceConnection onServiceConnected")
            lastComponentName = name?.flattenToShortString()
            // A new generation invalidates every callback from the dead
            // service instance: a late MSG_RESPONSE from the previous process
            // must not complete a request issued against this one.
            sessionGeneration++
            serviceMessenger = Messenger(binder)
            transitionTo(ServiceConnectionState.BOUND)
            try {
                binder?.linkToDeath(deathRecipient, 0)
            } catch (e: RemoteException) {
                FLog.w("FllamaPlugin linkToDeath failed: ${e.message}")
            }
            val generationAtConnect = sessionGeneration
            mainHandler.postDelayed({
                // Retry budget resets only after the connection proved stable.
                if (state == ServiceConnectionState.BOUND &&
                    sessionGeneration == generationAtConnect
                ) {
                    rebindAttempts = 0
                    FLog.d("FllamaPlugin connection stable; rebind budget reset")
                }
            }, STABLE_CONNECTION_MS)

            val queued = methodCallQueue.toList()
            methodCallQueue.clear()
            queued.forEach { (call, result) -> sendToService(call, result) }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            FLog.d("FllamaPlugin serviceConnection onServiceDisconnected")
            serviceMessenger = null
            transitionTo(ServiceConnectionState.DISCONNECTED)
            failPending(ServiceFailureCode.DISCONNECTED)
            scheduleRebind()
        }

        override fun onBindingDied(name: ComponentName?) {
            FLog.w("FllamaPlugin onBindingDied")
            serviceMessenger = null
            transitionTo(ServiceConnectionState.DEAD)
            failPending(ServiceFailureCode.DIED)
            scheduleRebind()
        }

        override fun onNullBinding(name: ComponentName?) {
            FLog.w("FllamaPlugin onNullBinding")
            transitionTo(ServiceConnectionState.FAILED)
            failPending(ServiceFailureCode.START_FAILED)
        }
    }

    private fun transitionTo(next: ServiceConnectionState) {
        if (state == ServiceConnectionState.DISPOSED) return
        FLog.d("FllamaPlugin state $state -> $next")
        state = next
    }

    override fun onAttachedToEngine(flutterPluginBinding: FlutterPlugin.FlutterPluginBinding) {
        FLog.d("FllamaPlugin onAttachedToEngine")
        channel = MethodChannel(flutterPluginBinding.binaryMessenger, "fllama")
        eventChannel = EventChannel(flutterPluginBinding.binaryMessenger, "fllama_event_channel")
        context = flutterPluginBinding.applicationContext
        state = ServiceConnectionState.UNBOUND
        bindInferenceService()
        channel.setMethodCallHandler(this)
        eventChannel.setStreamHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        FLog.d("FllamaPlugin onMethodCall ${call.method}")
        trackOperation(call)
        when (state) {
            ServiceConnectionState.DISPOSED -> {
                result.error(
                    ServiceFailureCode.DISCONNECTED.wire,
                    "The inference plugin has been detached.",
                    diagnostics(ServiceFailureCode.DISCONNECTED),
                )
                return
            }
            ServiceConnectionState.FAILED -> {
                // Recovery is explicit, never implicit: a failed state does
                // not silently retry on the next call. That was the previous
                // unbounded retry surface.
                result.error(
                    ServiceFailureCode.REBIND_EXHAUSTED.wire,
                    "The inference service could not be recovered after " +
                        "$MAX_REBIND_ATTEMPTS attempts. Restart the app to try again.",
                    diagnostics(ServiceFailureCode.REBIND_EXHAUSTED),
                )
                return
            }
            ServiceConnectionState.BOUND -> {
                val messenger = serviceMessenger
                if (messenger != null) {
                    sendToService(call, result)
                    return
                }
                methodCallQueue.add(Pair(call, result))
                bindInferenceService()
            }
            else -> {
                // BINDING / REBINDING / DISCONNECTED / DEAD / UNBOUND: queue
                // and let the single in-flight bind attempt drain it. No
                // concurrent bind is ever started from here.
                methodCallQueue.add(Pair(call, result))
                bindInferenceService()
            }
        }
    }

    /** Records what the runtime is doing, so a failure says which phase died. */
    private fun trackOperation(call: MethodCall) {
        activeOperation = when (call.method) {
            "initContext" -> ServiceOperationPhase.LOAD
            "completion" -> ServiceOperationPhase.GENERATION
            "stopCompletion" -> ServiceOperationPhase.CANCELLATION
            "releaseContext", "releaseAllContexts" -> ServiceOperationPhase.DISPOSAL
            else -> activeOperation
        }
        if (call.method == "initContext") {
            val path = (call.argument<String>("modelPath")
                ?: call.argument<String>("model_path"))
            activeModelFingerprint = ServiceDiagnostics.fingerprint(path)
        }
    }

    /**
     * Single serialized entry point for binding. Concurrent callers observe
     * BINDING/REBINDING and return immediately, so N queued method calls can
     * never produce N bindService() calls.
     */
    private fun bindInferenceService() {
        val appContext = context ?: return
        if (state == ServiceConnectionState.BINDING ||
            state == ServiceConnectionState.REBINDING ||
            state == ServiceConnectionState.BOUND ||
            state == ServiceConnectionState.DISPOSED ||
            state == ServiceConnectionState.FAILED
        ) {
            return
        }
        transitionTo(ServiceConnectionState.BINDING)
        val intent = Intent(appContext, FllamaService::class.java)
        val boundSuccessfully = try {
            appContext.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        } catch (e: SecurityException) {
            FLog.w("FllamaPlugin bindService threw: ${e.message}")
            false
        }
        FLog.d("FllamaPlugin bindService status=$boundSuccessfully")
        if (boundSuccessfully) {
            connectionRegistered = true
            return
        }
        transitionTo(ServiceConnectionState.UNBOUND)
        failQueued(ServiceFailureCode.BIND_FAILED)
    }

    /**
     * Bounded rebinding with exponential backoff and jitter. Never issues a
     * bind while one is outstanding, and gives up permanently (FAILED) rather
     * than looping forever.
     */
    private fun scheduleRebind() {
        if (state == ServiceConnectionState.DISPOSED) return
        scheduledRebind?.let { mainHandler.removeCallbacks(it) }
        if (rebindAttempts >= MAX_REBIND_ATTEMPTS) {
            FLog.w("FllamaPlugin rebind budget exhausted after $rebindAttempts attempts")
            transitionTo(ServiceConnectionState.FAILED)
            failQueued(ServiceFailureCode.REBIND_EXHAUSTED)
            return
        }
        rebindAttempts++
        val exponential = BASE_BACKOFF_MS shl (rebindAttempts - 1)
        val capped = min(exponential, MAX_BACKOFF_MS)
        // Jitter prevents a fleet of clients from retrying in lockstep.
        val delay = capped / 2 + Random.nextLong(capped / 2 + 1)
        FLog.d("FllamaPlugin rebind attempt $rebindAttempts in ${delay}ms")
        transitionTo(ServiceConnectionState.REBINDING)
        val runnable = Runnable {
            if (state != ServiceConnectionState.REBINDING) return@Runnable
            // Drop back to UNBOUND so bindInferenceService() will act.
            state = ServiceConnectionState.UNBOUND
            bindInferenceService()
        }
        scheduledRebind = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    private fun sendToService(call: MethodCall, result: Result) {
        val messenger = serviceMessenger
        if (messenger == null) {
            methodCallQueue.add(Pair(call, result))
            bindInferenceService()
            return
        }
        val requestId = requestIds.getAndIncrement()
        pendingResults[requestId] = PendingRequest(result, call.method, sessionGeneration)
        val msg = Message.obtain(null, FllamaIpc.MSG_METHOD)
        msg.replyTo = incomingMessenger
        msg.data = Bundle().apply {
            putInt(FllamaIpc.KEY_REQUEST_ID, requestId)
            putString(FllamaIpc.KEY_METHOD, call.method)
            putSerializable(FllamaIpc.KEY_ARGUMENTS, call.arguments as? Serializable)
        }
        try {
            messenger.send(msg)
        } catch (e: RemoteException) {
            pendingResults.remove(requestId)
            serviceMessenger = null
            transitionTo(ServiceConnectionState.DEAD)
            result.error(
                ServiceFailureCode.BINDER_DIED.wire,
                "The inference service IPC channel was lost while sending " +
                    "${call.method} (${e.javaClass.simpleName}).",
                diagnostics(ServiceFailureCode.BINDER_DIED, requestId),
            )
            scheduleRebind()
        }
    }

    private fun handleServiceResponse(data: Bundle) {
        data.classLoader = javaClass.classLoader
        val requestId = data.getInt(FllamaIpc.KEY_REQUEST_ID)
        val pending = pendingResults.remove(requestId) ?: return
        // A response from a previous service generation is stale: the request
        // it belongs to was already failed when that generation died.
        if (pending.generation != sessionGeneration) {
            FLog.w(
                "FllamaPlugin discarding stale response for request $requestId " +
                    "(generation ${pending.generation} != $sessionGeneration)"
            )
            return
        }
        val errorCode = data.getString(FllamaIpc.KEY_ERROR_CODE)
        if (errorCode != null) {
            pending.result.error(
                errorCode,
                data.getString(FllamaIpc.KEY_ERROR_MESSAGE),
                data.getString(FllamaIpc.KEY_ERROR_DETAILS),
            )
        } else {
            pending.result.success(data.getSerializable(FllamaIpc.KEY_RESULT))
        }
    }

    private fun handleServiceEvent(data: Bundle) {
        data.classLoader = javaClass.classLoader
        @Suppress("UNCHECKED_CAST")
        val event = data.getSerializable(FllamaIpc.KEY_EVENT) as? HashMap<String, Any>
        if (event != null) eventSink?.success(event)
    }

    /**
     * Structured diagnostics for a service failure. Replaces the `null`
     * details argument that made `SERVICE_DISCONNECTED` unclassifiable.
     * Consults ApplicationExitInfo so a low-memory kill is reported as one —
     * and, critically, so an exit Android does not explain stays UNKNOWN.
     */
    private fun diagnostics(code: ServiceFailureCode, requestId: Int? = null): String {
        val ctx = context
        val exit = ctx?.let { ServiceExitInspector.inspect(it) }
        val memory = ctx?.let { ServiceExitInspector.memoryState(it) }
        return ServiceDiagnostics.build(
            componentName = lastComponentName,
            state = state,
            bindingCompleted = connectionRegistered,
            requestActive = pendingResults.isNotEmpty(),
            operation = activeOperation,
            activeRequestId = requestId ?: pendingResults.keys.firstOrNull(),
            modelFingerprint = activeModelFingerprint,
            rebindAttempts = rebindAttempts,
            sessionGeneration = sessionGeneration,
            exit = exit,
            memory = memory,
        )
    }

    /**
     * Resolves the reported code against exit evidence. A disconnect that
     * Android attributes to a low-memory kill is reported as such; one it
     * cannot explain keeps the code the lifecycle callback implied. No
     * disconnect is ever assumed to be OOM.
     */
    private fun resolveCode(code: ServiceFailureCode): ServiceFailureCode {
        val ctx = context ?: return code
        val exit = ServiceExitInspector.inspect(ctx) ?: return code
        return when (exit.code) {
            ServiceFailureCode.LOW_MEMORY_KILL,
            ServiceFailureCode.NATIVE_CRASH,
            ServiceFailureCode.JVM_CRASH -> exit.code
            else -> code
        }
    }

    /** Fails every in-flight request exactly once with a classified code. */
    private fun failPending(code: ServiceFailureCode) {
        if (pendingResults.isEmpty()) return
        val resolved = resolveCode(code)
        val details = diagnostics(resolved)
        val pending = pendingResults.values.toList()
        pendingResults.clear()
        pending.forEach {
            it.result.error(resolved.wire, describe(resolved), details)
        }
    }

    /** Fails everything still queued for delivery (never sent to the service). */
    private fun failQueued(code: ServiceFailureCode) {
        if (methodCallQueue.isEmpty()) return
        val details = diagnostics(code)
        val queued = methodCallQueue.toList()
        methodCallQueue.clear()
        queued.forEach { (_, result) ->
            result.error(code.wire, describe(code), details)
        }
    }

    private fun describe(code: ServiceFailureCode): String = when (code) {
        ServiceFailureCode.DISCONNECTED ->
            "The on-device inference service disconnected. This is a service fault, not a problem with the model."
        ServiceFailureCode.BIND_FAILED ->
            "The app could not bind to the on-device inference service."
        ServiceFailureCode.DIED ->
            "The on-device inference service process stopped unexpectedly."
        ServiceFailureCode.BINDER_DIED ->
            "The IPC channel to the on-device inference service was lost."
        ServiceFailureCode.START_FAILED ->
            "The on-device inference service could not be started."
        ServiceFailureCode.REBIND_EXHAUSTED ->
            "The inference service could not be recovered after $MAX_REBIND_ATTEMPTS attempts."
        ServiceFailureCode.LOW_MEMORY_KILL ->
            "Android stopped the inference service to reclaim memory. The model itself is unaffected."
        ServiceFailureCode.NATIVE_CRASH ->
            "The inference service stopped due to a native crash."
        ServiceFailureCode.JVM_CRASH ->
            "The inference service stopped due to an unhandled Java/Kotlin exception."
        ServiceFailureCode.UNKNOWN_EXIT ->
            "The inference service stopped for a reason this Android version does not report."
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        FLog.d("FllamaPlugin onDetachedFromEngine")
        scheduledRebind?.let { mainHandler.removeCallbacks(it) }
        scheduledRebind = null
        failPending(ServiceFailureCode.DISCONNECTED)
        failQueued(ServiceFailureCode.DISCONNECTED)
        if (connectionRegistered) {
            try {
                context?.unbindService(serviceConnection)
            } catch (_: Exception) {
            }
            connectionRegistered = false
        }
        transitionTo(ServiceConnectionState.DISPOSED)
        channel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        FLog.d("FllamaPlugin onAttachedToActivity")
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {}

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        FLog.d("FllamaPlugin onReattachedToActivityForConfigChanges")
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        FLog.d("FllamaPlugin onDetachedFromActivity")
        activity = null
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
    }

    override fun onCancel(arguments: Any?) {
        eventSink = null
    }
}

object FllamaIpc {
    const val MSG_METHOD = 1
    const val MSG_RESPONSE = 2
    const val MSG_EVENT = 3
    const val KEY_REQUEST_ID = "requestId"
    const val KEY_METHOD = "method"
    const val KEY_ARGUMENTS = "arguments"
    const val KEY_RESULT = "result"
    const val KEY_ERROR_CODE = "errorCode"
    const val KEY_ERROR_MESSAGE = "errorMessage"
    const val KEY_ERROR_DETAILS = "errorDetails"
    const val KEY_EVENT = "event"
}
