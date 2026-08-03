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

/** FllamaPlugin */
class FllamaPlugin : FlutterPlugin, MethodCallHandler, ActivityAware, EventChannel.StreamHandler {
    private lateinit var channel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private var context: Context? = null
    private var activity: Activity? = null
    private var serviceMessenger: Messenger? = null
    private var bound = false
    private var rebindAttemptedAfterDeath = false
    private val requestIds = AtomicInteger(1)
    private val pendingResults = LinkedHashMap<Int, Result>()
    private val methodCallQueue = mutableListOf<Pair<MethodCall, Result>>()

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
        Handler(Looper.getMainLooper()).post {
            FLog.w("FllamaPlugin inference service binder died")
            serviceMessenger = null
            bound = false
            failPending("SERVICE_DIED", "The inference service stopped unexpectedly.")
            if (!rebindAttemptedAfterDeath) {
                rebindAttemptedAfterDeath = true
                bindInferenceService()
            }
        }
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            FLog.d("FllamaPlugin serviceConnection onServiceConnected")
            bound = true
            rebindAttemptedAfterDeath = false
            serviceMessenger = Messenger(binder)
            try {
                binder?.linkToDeath(deathRecipient, 0)
            } catch (e: RemoteException) {
                FLog.w("FllamaPlugin linkToDeath failed: ${e.message}")
            }
            val queued = methodCallQueue.toList()
            methodCallQueue.clear()
            queued.forEach { (call, result) -> sendToService(call, result) }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            FLog.d("FllamaPlugin serviceConnection onServiceDisconnected")
            serviceMessenger = null
            bound = false
            failPending("SERVICE_DISCONNECTED", "The inference service disconnected.")
        }
    }

    override fun onAttachedToEngine(flutterPluginBinding: FlutterPlugin.FlutterPluginBinding) {
        FLog.d("FllamaPlugin onAttachedToEngine")
        channel = MethodChannel(flutterPluginBinding.binaryMessenger, "fllama")
        eventChannel = EventChannel(flutterPluginBinding.binaryMessenger, "fllama_event_channel")
        context = flutterPluginBinding.applicationContext
        bindInferenceService()
        channel.setMethodCallHandler(this)
        eventChannel.setStreamHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        FLog.d("FllamaPlugin onMethodCall ${call.method}")
        if (bound && serviceMessenger != null) {
            sendToService(call, result)
        } else {
            methodCallQueue.add(Pair(call, result))
            bindInferenceService()
        }
    }

    private fun bindInferenceService() {
        val appContext = context ?: return
        val intent = Intent(appContext, FllamaService::class.java)
        val boundSuccessfully = appContext.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        FLog.d("FllamaPlugin bindService status=$boundSuccessfully")
        if (!boundSuccessfully) {
            val queued = methodCallQueue.toList()
            methodCallQueue.clear()
            queued.forEach { (_, result) ->
                result.error("SERVICE_BIND_FAILED", "Could not bind the inference service.", null)
            }
        }
    }

    private fun sendToService(call: MethodCall, result: Result) {
        val messenger = serviceMessenger
        if (messenger == null) {
            methodCallQueue.add(Pair(call, result))
            bindInferenceService()
            return
        }
        val requestId = requestIds.getAndIncrement()
        pendingResults[requestId] = result
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
            result.error("SERVICE_SEND_FAILED", e.localizedMessage, null)
            if (!rebindAttemptedAfterDeath) {
                rebindAttemptedAfterDeath = true
                bindInferenceService()
            }
        }
    }

    private fun handleServiceResponse(data: Bundle) {
        data.classLoader = javaClass.classLoader
        val requestId = data.getInt(FllamaIpc.KEY_REQUEST_ID)
        val result = pendingResults.remove(requestId) ?: return
        val errorCode = data.getString(FllamaIpc.KEY_ERROR_CODE)
        if (errorCode != null) {
            result.error(errorCode, data.getString(FllamaIpc.KEY_ERROR_MESSAGE), data.getString(FllamaIpc.KEY_ERROR_DETAILS))
        } else {
            result.success(data.getSerializable(FllamaIpc.KEY_RESULT))
        }
    }

    private fun handleServiceEvent(data: Bundle) {
        data.classLoader = javaClass.classLoader
        @Suppress("UNCHECKED_CAST")
        val event = data.getSerializable(FllamaIpc.KEY_EVENT) as? HashMap<String, Any>
        if (event != null) eventSink?.success(event)
    }

    private fun failPending(code: String, message: String) {
        val pending = pendingResults.values.toList()
        pendingResults.clear()
        pending.forEach { it.error(code, message, null) }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        FLog.d("FllamaPlugin onDetachedFromEngine")
        failPending("PLUGIN_DETACHED", "The fllama plugin was detached.")
        try {
            context?.unbindService(serviceConnection)
        } catch (_: Exception) {
        }
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
