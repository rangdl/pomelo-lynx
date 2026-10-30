import AVFoundation
import Foundation
import MediaPlayer
import UIKit

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
  private var queue: [QueueItem] = []
  private var queueIndex = -1
  private var currentTitle = ""
  private var currentArtist = ""
  private var currentAlbum = ""
  private var currentArtworkURL: URL?
  private var currentArtwork: MPMediaItemArtwork?
  private var artworkCache: [String: MPMediaItemArtwork] = [:]
  private var artworkLoadingKey = ""

  private struct QueueItem {
    let url: URL
    let title: String
    let artist: String
    let album: String
    let artwork: URL?
  }

  @objc static var name: String { "PomeloPlayer" }

  @objc static var methodLookup: [String: String] {
    [
      "load": NSStringFromSelector(#selector(PomeloPlayerModule.load(_:callback:))),
      "play": NSStringFromSelector(#selector(PomeloPlayerModule.play)),
      "pause": NSStringFromSelector(#selector(PomeloPlayerModule.pause)),
      "seek": NSStringFromSelector(#selector(PomeloPlayerModule.seek(_:))),
      "stop": NSStringFromSelector(#selector(PomeloPlayerModule.stop)),
      "getState": NSStringFromSelector(#selector(PomeloPlayerModule.getState(_:))),
      "setQueue": NSStringFromSelector(#selector(PomeloPlayerModule.setQueue(_:))),
      "next": NSStringFromSelector(#selector(PomeloPlayerModule.next)),
      "previous": NSStringFromSelector(#selector(PomeloPlayerModule.previous)),
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
    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false

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
    remoteTargets.append((center.nextTrackCommand, center.nextTrackCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async { self?.next() }
      return .success
    }))
    remoteTargets.append((center.previousTrackCommand, center.previousTrackCommand.addTarget {
      [weak self] _ in
      DispatchQueue.main.async { self?.previous() }
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

  private func load(
    url: URL,
    autoplay: Bool,
    index: Int? = nil,
    callback: ((String) -> Void)? = nil
  ) {
    guard configureAudioSession() else {
      callback?(errorJSON("player_audio_session_failed"))
      return
    }
    clearItemObservers()
    player.pause()
    player.replaceCurrentItem(with: nil)

    currentURL = url.absoluteString
    if let index {
      queueIndex = index >= 0 && index < queue.count ? index : -1
    } else {
      queueIndex = queue.firstIndex { $0.url == url } ?? -1
    }
    applyMetadata(for: url)
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
      self?.advanceAfterEnd()
    }

    player.replaceCurrentItem(with: nextItem)
    emit()
    if autoplay {
      player.play()
    }
    callback?("{\"ok\":true}")
  }

  private func advanceAfterEnd() {
    if queueIndex >= 0, queueIndex + 1 < queue.count {
      loadQueueItem(queueIndex + 1)
      return
    }
    stateName = "ended"
    player.pause()
    emit()
  }

  private func loadQueueItem(_ index: Int) {
    guard index >= 0, index < queue.count else { return }
    load(url: queue[index].url, autoplay: true, index: index)
  }

  private func httpURL(_ raw: String) -> URL? {
    guard
      let url = URL(string: raw),
      let scheme = url.scheme?.lowercased(),
      scheme == "https" || scheme == "http",
      url.host != nil
    else { return nil }
    return url
  }

  private func metadataText(_ raw: Any?, limit: Int = 200) -> String {
    guard let text = raw as? String else { return "" }
    return String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
  }

  private func applyMetadata(for url: URL) {
    let item: QueueItem? =
      queueIndex >= 0 && queueIndex < queue.count ? queue[queueIndex] : nil
    let title = item?.title ?? ""
    currentTitle = title.isEmpty ? url.lastPathComponent : title
    let artist = item?.artist ?? ""
    currentArtist = artist.isEmpty ? "Pomelo Lynx" : artist
    currentAlbum = item?.album ?? ""
    currentArtworkURL = item?.artwork
    let key = item?.artwork?.absoluteString ?? ""
    currentArtwork = key.isEmpty ? nil : artworkCache[key]
    if let artworkURL = item?.artwork, currentArtwork == nil, artworkLoadingKey != key {
      loadArtwork(url: artworkURL, key: key)
    }
  }

  private func loadArtwork(url: URL, key: String) {
    artworkLoadingKey = key
    URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
      var artwork: MPMediaItemArtwork?
      if
        let http = response as? HTTPURLResponse,
        http.statusCode == 200,
        let data,
        data.count <= 8 * 1024 * 1024,
        let image = UIImage(data: data)
      {
        artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      }
      DispatchQueue.main.async {
        guard let self else { return }
        if self.artworkLoadingKey == key {
          self.artworkLoadingKey = ""
        }
        guard let artwork else { return }
        self.artworkCache[key] = artwork
        if self.currentArtworkURL?.absoluteString == key {
          self.currentArtwork = artwork
          self.updateNowPlaying()
        }
      }
    }.resume()
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
      "queueIndex": queueIndex,
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
    let fallbackTitle = URL(string: currentURL)?.lastPathComponent ?? "Pomelo Audio"
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: currentTitle.isEmpty ? fallbackTitle : currentTitle,
      MPMediaItemPropertyArtist: currentArtist,
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: stateName == "playing" ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if !currentAlbum.isEmpty {
      info[MPMediaItemPropertyAlbumTitle] = currentAlbum
    }
    if let currentArtwork {
      info[MPMediaItemPropertyArtwork] = currentArtwork
    }
    if queueIndex >= 0 {
      info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = queueIndex
      info[MPNowPlayingInfoPropertyPlaybackQueueCount] = queue.count
    }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
      let url = httpURL(rawURL)
    else {
      callback(errorJSON("player_invalid_url"))
      return
    }
    let autoplay = request["autoplay"] as? Bool ?? true
    DispatchQueue.main.async {
      self.load(url: url, autoplay: autoplay, callback: callback)
    }
  }

  @objc func setQueue(_ requestJSON: String) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let rawItems = request["items"] as? [[String: Any]],
      rawItems.count <= 50
    else { return }
    var items: [QueueItem] = []
    for raw in rawItems {
      let title = metadataText(raw["title"])
      guard
        let rawURL = raw["url"] as? String,
        let url = httpURL(rawURL)
      else { return }
      items.append(
        QueueItem(
          url: url,
          title: title,
          artist: metadataText(raw["artist"]),
          album: metadataText(raw["album"]),
          artwork: (raw["artwork"] as? String).flatMap { httpURL($0) }
        )
      )
    }
    let rawIndex = request["index"] as? Int ?? -1
    let index = rawIndex >= 0 && rawIndex < items.count ? rawIndex : -1
    DispatchQueue.main.async {
      self.queue = items
      self.queueIndex = index
      if index >= 0 {
        self.applyMetadata(for: items[index].url)
      }
      let center = MPRemoteCommandCenter.shared()
      let multiple = items.count > 1
      center.nextTrackCommand.isEnabled = multiple
      center.previousTrackCommand.isEnabled = multiple
      self.emit()
    }
  }

  @objc func next() {
    DispatchQueue.main.async {
      guard self.queueIndex + 1 < self.queue.count else { return }
      self.loadQueueItem(self.queueIndex + 1)
    }
  }

  @objc func previous() {
    DispatchQueue.main.async {
      guard self.queueIndex > 0 else {
        self.seek(0)
        return
      }
      self.loadQueueItem(self.queueIndex - 1)
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
      self.currentTitle = ""
      self.currentArtist = ""
      self.currentAlbum = ""
      self.currentArtworkURL = nil
      self.currentArtwork = nil
      self.artworkLoadingKey = ""
      self.stateName = "idle"
      self.position = 0
      self.duration = 0
      self.errorCode = ""
      self.queueIndex = -1
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
