package ink.xcl.fllama

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel.Result
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.Serializable

class FllamaService : Service() {
    private var fLlama: FLlama? = null

    private val incomingMessenger = Messenger(
        object : Handler(Looper.getMainLooper()) {
            override fun handleMessage(msg: Message) {
                if (msg.what == FllamaIpc.MSG_METHOD) {
                    handleIpcMethod(msg)
                } else {
                    super.handleMessage(msg)
                }
            }
        }
    )

    override fun onCreate() {
        super.onCreate()
        FLog.d("FllamaService onCreate")
        fLlama = FLlama(applicationContext)
    }

    override fun onBind(intent: Intent): IBinder = incomingMessenger.binder

    private fun handleIpcMethod(message: Message) {
        val data = message.data
        data.classLoader = javaClass.classLoader
        val requestId = data.getInt(FllamaIpc.KEY_REQUEST_ID)
        val method = data.getString(FllamaIpc.KEY_METHOD) ?: ""
        val args = data.getSerializable(FllamaIpc.KEY_ARGUMENTS)
        val replyTo = message.replyTo
        val call = MethodCall(method, args)
        val result = IpcResult(requestId, replyTo)

        try {
            FLog.d("FllamaService IPC method=$method request=$requestId")
            when (method) {
                "getFileSHA256" -> fLlama?.getFileSHA256(call, result)
                "getCpuInfo" -> fLlama?.getCpuInfo(result)
                "initContext" -> fLlama?.initContext(call, result) { tokenResult ->
                    sendEvent(replyTo, tokenResult)
                }
                "getFormattedChat" -> fLlama?.getFormattedChat(call, result)
                "loadSession" -> fLlama?.loadSession(call, result)
                "saveSession" -> fLlama?.saveSession(call, result)
                "completion" -> fLlama?.completion(call, result) { tokenResult ->
                    sendEvent(replyTo, tokenResult)
                }
                "stopCompletion" -> fLlama?.stopCompletion(call, result)
                "tokenize" -> fLlama?.tokenize(call, result)
                "detokenize" -> fLlama?.detokenize(call, result)
                "bench" -> fLlama?.bench(call, result)
                "releaseContext" -> fLlama?.releaseContext(call, result)
                "releaseAllContexts" -> fLlama?.releaseAllContexts(result)
                else -> result.notImplemented()
            } ?: result.error("SERVICE_NOT_READY", "The inference service is not ready.", null)
        } catch (e: Exception) {
            result.error("ERROR", "An error occurred: ${e.message}", null)
        }
    }

    private fun sendEvent(replyTo: Messenger?, tokenResult: HashMap<String, Any>) {
        if (replyTo == null) return
        val msg = Message.obtain(null, FllamaIpc.MSG_EVENT)
        msg.data = Bundle().apply {
            putSerializable(FllamaIpc.KEY_EVENT, tokenResult)
        }
        try {
            replyTo.send(msg)
        } catch (e: RemoteException) {
            FLog.w("FllamaService event send failed: ${e.message}")
        }
    }

    override fun onDestroy() {
        try {
            CoroutineScope(Dispatchers.IO).launch {
                fLlama?.onDestroy()
            }
            fLlama = null
        } catch (_: Exception) {
        } finally {
            FLog.d("FllamaService onDestroy")
            super.onDestroy()
        }
    }

    private class IpcResult(
        private val requestId: Int,
        private val replyTo: Messenger?,
    ) : Result {
        override fun success(result: Any?) {
            val msg = Message.obtain(null, FllamaIpc.MSG_RESPONSE)
            msg.data = Bundle().apply {
                putInt(FllamaIpc.KEY_REQUEST_ID, requestId)
                putSerializable(FllamaIpc.KEY_RESULT, result as? Serializable)
            }
            send(msg)
        }

        override fun error(errorCode: String, errorMessage: String?, errorDetails: Any?) {
            val msg = Message.obtain(null, FllamaIpc.MSG_RESPONSE)
            msg.data = Bundle().apply {
                putInt(FllamaIpc.KEY_REQUEST_ID, requestId)
                putString(FllamaIpc.KEY_ERROR_CODE, errorCode)
                putString(FllamaIpc.KEY_ERROR_MESSAGE, errorMessage)
                putString(FllamaIpc.KEY_ERROR_DETAILS, errorDetails?.toString())
            }
            send(msg)
        }

        override fun notImplemented() {
            error("NOT_IMPLEMENTED", "Method is not implemented by the inference service.", null)
        }

        private fun send(msg: Message) {
            try {
                replyTo?.send(msg)
            } catch (e: RemoteException) {
                FLog.w("FllamaService response send failed: ${e.message}")
            }
        }
    }
}
