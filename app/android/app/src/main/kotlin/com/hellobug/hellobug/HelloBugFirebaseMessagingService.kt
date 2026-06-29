package com.hellobug.hellobug

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService

class HelloBugFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    val normalized = token.trim()
    if (normalized.isEmpty()) {
      return
    }

    PushTokenBridgePlugin.publishToken(applicationContext, normalized)
    Log.d(TAG, "FCM token refreshed")
  }

  companion object {
    private const val TAG = "PushTokenBridge"
  }
}
