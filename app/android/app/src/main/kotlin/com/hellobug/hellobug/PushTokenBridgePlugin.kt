package com.hellobug.hellobug

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class PushTokenBridgePlugin :
  FlutterPlugin,
  MethodChannel.MethodCallHandler,
  EventChannel.StreamHandler {
  private var applicationContext: Context? = null
  private var methodsChannel: MethodChannel? = null
  private var eventsChannel: EventChannel? = null
  private var eventSink: EventChannel.EventSink? = null

  override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    applicationContext = binding.applicationContext
    methodsChannel =
      MethodChannel(binding.binaryMessenger, METHODS_CHANNEL_NAME).also {
        it.setMethodCallHandler(this)
      }
    eventsChannel =
      EventChannel(binding.binaryMessenger, EVENTS_CHANNEL_NAME).also {
        it.setStreamHandler(this)
      }
    shared = this
  }

  override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    if (shared === this) {
      shared = null
    }
    eventSink = null
    methodsChannel?.setMethodCallHandler(null)
    eventsChannel?.setStreamHandler(null)
    methodsChannel = null
    eventsChannel = null
    applicationContext = null
  }

  override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
    if (call.method != "initialize") {
      result.notImplemented()
      return
    }

    val context = applicationContext
    if (context == null) {
      result.success("")
      return
    }

    fetchToken(context)
    result.success(readLastToken(context))
  }

  override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
    eventSink = events
    val context = applicationContext ?: return
    val lastToken = readLastToken(context)
    if (lastToken.isNotEmpty()) {
      events.success(lastToken)
    }
    fetchToken(context)
  }

  override fun onCancel(arguments: Any?) {
    eventSink = null
  }

  private fun fetchToken(context: Context) {
    if (!ensureFirebaseApp(context)) {
      Log.d(TAG, "Firebase not configured; Android push token unavailable")
      return
    }

    FirebaseMessaging
      .getInstance()
      .token
      .addOnSuccessListener { token ->
        val normalized = token.trim()
        if (normalized.isEmpty()) {
          return@addOnSuccessListener
        }
        publishToken(context, normalized)
        Log.d(TAG, "FCM token received")
      }
      .addOnFailureListener { error ->
        Log.d(TAG, "FCM token fetch failed -> ${error.message}", error)
      }
  }

  private fun ensureFirebaseApp(context: Context): Boolean {
    if (FirebaseApp.getApps(context).isNotEmpty()) {
      return true
    }

    return try {
      FirebaseApp.initializeApp(context) != null
    } catch (error: IllegalStateException) {
      Log.d(TAG, "Firebase init failed -> ${error.message}", error)
      false
    }
  }

  companion object {
    private const val TAG = "PushTokenBridge"
    private const val PREFS_NAME = "hellobug.push_token"
    private const val PREF_KEY_TOKEN = "last_token"
    private const val METHODS_CHANNEL_NAME = "hellobug.push_token/methods"
    private const val EVENTS_CHANNEL_NAME = "hellobug.push_token/events"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var shared: PushTokenBridgePlugin? = null

    fun publishToken(context: Context, token: String) {
      val normalized = token.trim()
      if (normalized.isEmpty()) {
        return
      }

      context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_KEY_TOKEN, normalized)
        .apply()

      mainHandler.post {
        shared?.eventSink?.success(normalized)
      }
    }

    private fun readLastToken(context: Context): String =
      context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_KEY_TOKEN, "")
        ?.trim()
        .orEmpty()
  }
}
