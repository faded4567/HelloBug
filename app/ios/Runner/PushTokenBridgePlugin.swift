import Flutter
import UIKit

final class PushTokenBridgePlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
  private static var shared: PushTokenBridgePlugin?
  private static let methodsChannelName = "hellobug.push_token/methods"
  private static let eventsChannelName = "hellobug.push_token/events"

  private var eventSink: FlutterEventSink?
  private var lastToken: String?

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = PushTokenBridgePlugin()
    shared = instance

    let methodChannel = FlutterMethodChannel(
      name: methodsChannelName,
      binaryMessenger: registrar.messenger()
    )
    let eventChannel = FlutterEventChannel(
      name: eventsChannelName,
      binaryMessenger: registrar.messenger()
    )

    registrar.addMethodCallDelegate(instance, channel: methodChannel)
    eventChannel.setStreamHandler(instance)
    registrar.addApplicationDelegate(instance)

  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "initialize":
      registerForRemoteNotifications()
      result(lastToken ?? "")
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func onListen(
    withArguments _: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    eventSink = events
    if let token = lastToken, !token.isEmpty {
      events(token)
    }
    return nil
  }

  func onCancel(withArguments _: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    lastToken = token
    eventSink?(token)
    print("[PushTokenBridge] APNS token received")
  }

  func application(
    _: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    print("[PushTokenBridge] APNS registration failed -> \(error)")
  }

  private func registerForRemoteNotifications() {
    DispatchQueue.main.async { [weak self] in
      UIApplication.shared.registerForRemoteNotifications()
      if let token = self?.lastToken, !token.isEmpty {
        self?.eventSink?(token)
      }
    }
  }
}
