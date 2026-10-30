import AVFoundation
import Foundation
import MediaPlayer

/**
 * Lynx native module `NativeModules.PomeloPlayer`.
 *
 * MVP 只做 iOS 音频:
 *   - load(requestJSON, callback): {url, autoplay}
 *   - play / pause / stop
 *   - seek(seconds)
 *   - getState(callback)
 *
 * 播放状态通过 `PomeloPlayer.state` 全局事件推送。播放器单例挂在本模块实例上,
 * 页面切换不会停止音频;是否后台播放留到后续版本。
 */
final class PomeloPlayerModule: NSObject, LynxContextModule {
  private weak var context: LynxContext?
  private let player = AVPlayer()
  private var item: AVPlayerItem?
  private var statusObservation: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var timeObserver: Any?
  private var interruptionObserver: NSObjectProtocol?
  private var remoteTargets: [(MPRemoteCommand, Any)] = []
  private var currentURL = ""
  private var stateName = "idle"
  private var position: Double = 0
  private var duration: Double = 0
  private var errorCode = ""

  @objc static var name: String { "PomeloPlayer" }

  @objc static var methodLookup: [String: String] {
    [
      "load": NSStringFromSelector(#selector(PomeloPlayerModule.load(_:callback:))),
      "play": NSStringFromSelector(#selector(PomeloPlayerModule.play)),
      "pause": NSStringFromSelector(#selector(PomeloPlayerModule.pause)),
      "seek": NSStringFromSelector(#selector(PomeloPlayerModule.seek(_:))),
      "stop": NSStringFromSelector(#selector(PomeloPlayerModule.stop)),
      "getState": NSStringFromSelector(#selector(PomeloPlayerModule.getState(_:))),
    ]
  }

  @objc(initWithParam:)
  convenience init(param: Any) { self.init(context: nil) }

  @objc(initWithLynxContext:)
  convenience init(lynxContext context: LynxContext) { self.init(context: context) }

  @objc(initWithLynxContext:WithParam:)
  convenience init(lynxContext context: LynxContext, withParam param: Any) {
    self.init(context: context)
  }

  override init() {
    super.init()
    installObservers()
  }

  private init(context: LynxContext?) {
    self.context = context
    super.init()
    installObservers()
  }

  deinit {
    if let timeObserver {
      player.removeTimeObserver(timeObserver)
    }
    statusObservation?.invalidate()
    if let endObserver {
      NotificationCenter.default.removeObserver(endObserver)
    }
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
    }
    for (command, token) in remoteTargets {
      command.removeTarget(token)
    }
  }

  private func installObservers() {
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
      queue: .main
    ) { [weak self] time in
      self?.tick(time)
    }

    let center = MPRemoteCommandCenter.shared()
    center.playCommand.isEnabled = true
    center.pauseCommand.isEnabled = true
    center.togglePlayPauseCommand.isEnabled = true
    center.stopCommand.isEnabled = true
    center.changePlaybackPositionCommand.isEnabled = true

    remoteTargets.append((center.playCommand, center.playCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async { self?.play() }
      return .success
    }))
    remoteTargets.append((center.pauseCommand, center.pauseCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async { self?.pause() }
      return .success
    }))
    remoteTargets.append((center.togglePlayPauseCommand, center.togglePlayPauseCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        if self.stateName == "playing" {
          self.pause()
        } else {
          self.play()
        }
      }
      return .success
    }))
    remoteTargets.append((center.stopCommand, center.stopCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async { self?.stop() }
      return .success
    }))
    remoteTargets.append((center.changePlaybackPositionCommand, center.changePlaybackPositionCommand.addTarget {
      [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      DispatchQueue.main.async { self?.seek(event.positionTime) }
      return .success
    }))

    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      guard
        let self,
        let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: raw)
      else { return }
      switch type {
      case .began:
        self.player.pause()
        self.stateName = "paused"
        self.emit()
      case .ended:
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
        if options.contains(.shouldResume), self.item != nil {
          self.player.play()
          self.stateName = "playing"
          self.emit()
        }
      @unknown default:
        break
      }
    }
  }

  private func configureAudioSession() -> Bool {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
      return true
    } catch {
      return false
    }
  }

  private func clearItemObservers() {
    statusObservation?.invalidate()
    statusObservation = nil
    if let endObserver {
      NotificationCenter.default.removeObserver(endObserver)
      self.endObserver = nil
    }
  }

  private func load(url: URL, autoplay: Bool, callback: @escaping (String) -> Void) {
    guard configureAudioSession() else {
      callback(errorJSON("player_audio_session_failed"))
      return
    }
    clearItemObservers()
    player.pause()
    player.replaceCurrentItem(with: nil)

    currentURL = url.absoluteString
    position = 0
    duration = 0
    errorCode = ""
    stateName = "loading"

    let nextItem = AVPlayerItem(url: url)
    item = nextItem
    statusObservation = nextItem.observe(\.status, options: [.initial, .new]) {
      [weak self] observed, _ in
      DispatchQueue.main.async {
        self?.itemStatusChanged(observed)
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: nextItem,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.stateName = "ended"
      self.player.pause()
      self.emit()
    }

    player.replaceCurrentItem(with: nextItem)
    emit()
    if autoplay {
      player.play()
    }
    callback("{\"ok\":true}")
  }

  private func itemStatusChanged(_ changed: AVPlayerItem) {
    guard item === changed else { return }
    switch changed.status {
    case .readyToPlay:
      let seconds = CMTimeGetSeconds(changed.duration)
      if seconds.isFinite && seconds > 0 {
        duration = seconds
      }
      if player.rate > 0 {
        stateName = "playing"
      } else if stateName == "loading" {
        stateName = "paused"
      }
    case .failed:
      stateName = "error"
      errorCode = "player_item_failed"
    default:
      break
    }
    emit()
  }

  private func tick(_ time: CMTime) {
    let seconds = CMTimeGetSeconds(time)
    if seconds.isFinite && seconds >= 0 {
      position = seconds
    }
    guard stateName != "error", stateName != "ended" else {
      emit()
      return
    }
    switch player.timeControlStatus {
    case .playing:
      stateName = "playing"
    case .waitingToPlayAtSpecifiedRate:
      if stateName != "paused" { stateName = "loading" }
    case .paused:
      if stateName != "loading" { stateName = "paused" }
    @unknown default:
      break
    }
    emit()
  }

  private func payload() -> [String: Any] {
    [
      "state": stateName,
      "url": currentURL,
      "position": position,
      "duration": duration,
      "error": errorCode,
    ]
  }

  private func stateJSON() -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: payload()),
      let json = String(data: data, encoding: .utf8)
    else {
      return errorJSON("player_state_failed")
    }
    return json
  }

  private func errorJSON(_ code: String) -> String {
    "{\"error\":\"\(code)\"}"
  }

  private func updateNowPlaying() {
    if currentURL.isEmpty {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      MPNowPlayingInfoCenter.default().playbackState = .stopped
      return
    }
    let title = URL(string: currentURL)?.lastPathComponent ?? "Pomelo Audio"
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: "Pomelo Lynx",
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: stateName == "playing" ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    MPNowPlayingInfoCenter.default().playbackState =
      stateName == "playing" ? .playing : stateName == "paused" ? .paused : .stopped
  }

  private func emit() {
    updateNowPlaying()
    guard let context else { return }
    context.sendGlobalEvent("PomeloPlayer.state", withParams: [stateJSON()])
  }

  @objc func load(_ requestJSON: String, callback: @escaping (String) -> Void) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let rawURL = request["url"] as? String,
      let url = URL(string: rawURL),
      let scheme = url.scheme?.lowercased(),
      (scheme == "https" || scheme == "http"),
      url.host != nil
    else {
      callback(errorJSON("player_invalid_url"))
      return
    }
    let autoplay = request["autoplay"] as? Bool ?? true
    DispatchQueue.main.async {
      self.load(url: url, autoplay: autoplay, callback: callback)
    }
  }

  @objc func play() {
    DispatchQueue.main.async {
      guard self.item != nil else { return }
      self.player.play()
      self.stateName = "playing"
      self.emit()
    }
  }

  @objc func pause() {
    DispatchQueue.main.async {
      self.player.pause()
      if self.item != nil { self.stateName = "paused" }
      self.emit()
    }
  }

  @objc func seek(_ seconds: Double) {
    DispatchQueue.main.async {
      guard self.item != nil, seconds.isFinite else { return }
      let maximum = self.duration > 0 ? self.duration : seconds
      let target = min(max(0, seconds), maximum)
      self.player.seek(
        to: CMTime(seconds: target, preferredTimescale: 600),
        toleranceBefore: .zero,
        toleranceAfter: .zero
      )
      self.position = target
      self.emit()
    }
  }

  @objc func stop() {
    DispatchQueue.main.async {
      self.player.pause()
      self.player.replaceCurrentItem(with: nil)
      self.clearItemObservers()
      self.item = nil
      self.currentURL = ""
      self.stateName = "idle"
      self.position = 0
      self.duration = 0
      self.errorCode = ""
      self.emit()
      try? AVAudioSession.sharedInstance().setActive(
        false, options: .notifyOthersOnDeactivation)
    }
  }

  @objc func getState(_ callback: @escaping (String) -> Void) {
    DispatchQueue.main.async {
      callback(self.stateJSON())
    }
  }
}
