import AVFoundation
import Foundation
import Lynx
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
@objc(PomeloPlayerModule)
public final class PomeloPlayerModule: NSObject, LynxContextModule {
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
  private static let maxQueueItems = 500
  private var queueIndex = -1
  private var currentTitle = ""
  private var currentArtist = ""
  private var currentAlbum = ""
  private var currentArtworkURL: URL?
  private var currentArtwork: MPMediaItemArtwork?
  private var artworkCache: [String: MPMediaItemArtwork] = [:]
  private var artworkLoadingKey = ""
  private var playbackRate: Float = 1.0
  private var engineName = "system"
  private var lyricLines: [LyricLine] = []
  private var lyricMode = "title"
  private var currentLyric = ""
  private var overrideTitle = ""
  private var overrideArtist = ""
  private var overrideAlbum = ""
  private var overrideLyrics = ""
  private var refreshAttempts = 0
  private var desiredPlaying = false
  private var wasActuallyPlaying = false
  private var hasReportedLoaded = false
  private var pendingSeek: Double?
  private var pendingAutoplay = false
  private var pendingRefresh: PendingRefresh?
  private var refreshTimeout: DispatchWorkItem?
  private var errorLogObserver: NSObjectProtocol?
  private var failedObserver: NSObjectProtocol?

  private struct QueueItem {
    var url: URL
    var title: String
    var artist: String
    var album: String
    var artwork: URL?
    var headers: [String: String]
  }

  private struct PendingRefresh {
    let requestId: String
    let queueIndex: Int
    let url: String
    let position: Double
    var shouldPlay: Bool
  }

  private struct LyricLine {
    let time: Double
    let text: String
  }

  @objc public static var name: String { "PomeloPlayer" }

  @objc public static var methodLookup: [String: String] {
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
      "setLyrics": NSStringFromSelector(#selector(PomeloPlayerModule.setLyrics(_:))),
      "clearLyrics": NSStringFromSelector(#selector(PomeloPlayerModule.clearLyrics)),
      "setNowPlayingOverride": NSStringFromSelector(
        #selector(PomeloPlayerModule.setNowPlayingOverride(_:))),
      "clearNowPlayingOverride": NSStringFromSelector(
        #selector(PomeloPlayerModule.clearNowPlayingOverride)),
      "setRate": NSStringFromSelector(#selector(PomeloPlayerModule.setRate(_:))),
      "setVolume": NSStringFromSelector(#selector(PomeloPlayerModule.setVolume(_:))),
      "getCapabilities": NSStringFromSelector(
        #selector(PomeloPlayerModule.getCapabilities(_:))),
      "setEngine": NSStringFromSelector(#selector(PomeloPlayerModule.setEngine(_:callback:))),
      "resolveRefresh": NSStringFromSelector(#selector(PomeloPlayerModule.resolveRefresh(_:))),
    ]
  }

  @objc(initWithParam:)
  public convenience init(param: Any) { self.init(context: nil) }

  @objc(initWithLynxContext:)
  public convenience init(lynxContext context: LynxContext) { self.init(context: context) }

  @objc(initWithLynxContext:WithParam:)
  public convenience init(lynxContext context: LynxContext, withParam param: Any) {
    self.init(context: context)
  }

  public override init() {
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
    if let errorLogObserver {
      NotificationCenter.default.removeObserver(errorLogObserver)
    }
    if let failedObserver {
      NotificationCenter.default.removeObserver(failedObserver)
    }
    refreshTimeout?.cancel()
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
        self.desiredPlaying = false
        self.wasActuallyPlaying = false
        self.stateName = "paused"
        self.emitEvent("paused")
        self.emit()
      case .ended:
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
        if options.contains(.shouldResume), self.item != nil {
          self.player.play()
          self.desiredPlaying = true
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
    if let errorLogObserver {
      NotificationCenter.default.removeObserver(errorLogObserver)
      self.errorLogObserver = nil
    }
    if let failedObserver {
      NotificationCenter.default.removeObserver(failedObserver)
      self.failedObserver = nil
    }
  }

  private func makeAsset(url: URL, headers: [String: String]) -> AVURLAsset {
    if headers.isEmpty {
      return AVURLAsset(url: url)
    }
    return AVURLAsset(
      url: url,
      options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
  }

  /// 为当前 item 安装状态、结束、HTTP 错误日志与失败通知。
  private func observeItem(_ nextItem: AVPlayerItem) {
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
    errorLogObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemNewErrorLogEntry,
      object: nextItem,
      queue: .main
    ) { [weak self] _ in
      self?.handleErrorLog(for: nextItem)
    }
    failedObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime,
      object: nextItem,
      queue: .main
    ) { [weak self] notification in
      guard let self else { return }
      let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
      self.handleItemFailure(nextItem, error: error)
    }
  }

  private func load(
    url: URL,
    autoplay: Bool,
    index: Int? = nil,
    headers: [String: String] = [:],
    callback: ((String) -> Void)? = nil
  ) {
    guard configureAudioSession() else {
      callback?(errorJSON("player_audio_session_failed"))
      return
    }
    clearItemObservers()
    cancelPendingRefresh()
    player.pause()
    player.replaceCurrentItem(with: nil)

    pendingSeek = nil
    pendingAutoplay = false
    hasReportedLoaded = false
    wasActuallyPlaying = false
    desiredPlaying = autoplay
    refreshAttempts = 0
    currentURL = url.absoluteString
    if let index {
      queueIndex = index >= 0 && index < queue.count ? index : -1
    } else {
      queueIndex = queue.firstIndex { $0.url == url } ?? -1
    }
    let effectiveHeaders =
      headers.isEmpty && queueIndex >= 0 && queueIndex < queue.count
      ? queue[queueIndex].headers : headers
    applyMetadata(for: url)
    lyricLines = []
    currentLyric = ""
    overrideTitle = ""
    overrideArtist = ""
    overrideAlbum = ""
    overrideLyrics = ""
    position = 0
    duration = 0
    errorCode = ""
    stateName = "loading"

    let nextItem = AVPlayerItem(asset: makeAsset(url: url, headers: effectiveHeaders))
    item = nextItem
    observeItem(nextItem)

    player.replaceCurrentItem(with: nextItem)
    emitEvent("track", extra: ["autoplay": autoplay])
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
    desiredPlaying = false
    wasActuallyPlaying = false
    player.pause()
    emitEvent("ended")
    emit()
  }

  private func loadQueueItem(_ index: Int) {
    guard index >= 0, index < queue.count else { return }
    load(
      url: queue[index].url,
      autoplay: true,
      index: index,
      headers: queue[index].headers)
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

  private static func parseHeaders(_ raw: Any?) -> [String: String] {
    guard let raw = raw as? [String: Any], raw.count <= 16 else { return [:] }
    var headers: [String: String] = [:]
    for (key, value) in raw {
      guard
        let text = value as? String,
        !key.isEmpty,
        key.count <= 128,
        text.count <= 2048,
        !key.contains("\n"),
        !key.contains("\r"),
        !text.contains("\n"),
        !text.contains("\r")
      else { continue }
      headers[key] = text
    }
    return headers
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
      if !hasReportedLoaded {
        hasReportedLoaded = true
        emitEvent("loaded")
      }
      if let seek = pendingSeek {
        pendingSeek = nil
        let target = CMTime(seconds: seek, preferredTimescale: 600)
        player.seek(
          to: target,
          toleranceBefore: .zero,
          toleranceAfter: .zero
        ) { [weak self] _ in
          guard let self, self.item === changed else { return }
          self.position = seek
          if self.pendingAutoplay {
            self.pendingAutoplay = false
            self.player.play()
          }
          self.emit()
        }
      } else if pendingAutoplay {
        pendingAutoplay = false
        player.play()
      }
      if player.rate > 0 {
        stateName = "playing"
      } else if stateName == "loading" {
        stateName = "paused"
      }
    case .failed:
      handleItemFailure(changed, error: changed.error)
      return
    default:
      break
    }
    emit()
  }

  /// 从 AVPlayerItem 的错误日志里优先取鉴权状态，否则取最近一次 HTTP 状态码。
  private func httpStatus(of item: AVPlayerItem) -> Int {
    guard let events = item.errorLog()?.events, !events.isEmpty else {
      return 0
    }
    if let auth = events.last(where: {
      $0.errorStatusCode == 401 || $0.errorStatusCode == 403
    }) {
      return auth.errorStatusCode
    }
    return events.last?.errorStatusCode ?? 0
  }

  /// 错误日志可能先于 status=.failed 到达；只对 401/403 触发刷新。
  private func handleErrorLog(for item: AVPlayerItem) {
    guard item === self.item else { return }
    let status = httpStatus(of: item)
    guard status == 401 || status == 403 else { return }
    _ = requestRefresh(status: status)
  }

  @discardableResult
  private func handleItemFailure(_ failed: AVPlayerItem, error: Error?) -> Bool {
    guard failed === item else { return false }
    let status = httpStatus(of: failed)
    if status == 401 || status == 403 {
      if requestRefresh(status: status) {
        return true
      }
    }
    if stateName == "error", errorCode == "player_item_failed" {
      return true
    }
    stateName = "error"
    errorCode = "player_item_failed"
    // 保留 desiredPlaying：错误日志可能晚于 .failed 到达，随后仍可触发鉴权刷新。
    wasActuallyPlaying = false
    emitEvent("error", extra: ["error": errorCode, "status": status])
    emit()
    return true
  }

  private func cancelPendingRefresh() {
    refreshTimeout?.cancel()
    refreshTimeout = nil
    pendingRefresh = nil
  }

  /// 原生只负责发现鉴权失败并发事件；真正的 token 刷新在 JS Provider 层完成。
  @discardableResult
  private func requestRefresh(status: Int) -> Bool {
    guard pendingRefresh == nil else { return true }
    guard refreshAttempts < 3 else { return false }
    guard queueIndex >= 0, queueIndex < queue.count else { return false }
    refreshAttempts += 1
    let request = PendingRefresh(
      requestId: UUID().uuidString,
      queueIndex: queueIndex,
      url: currentURL,
      position: position,
      shouldPlay: desiredPlaying
    )
    pendingRefresh = request
    stateName = "loading"
    errorCode = ""
    wasActuallyPlaying = false
    player.pause()

    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.pendingRefresh?.requestId == request.requestId else {
        return
      }
      self.pendingRefresh = nil
      self.refreshTimeout = nil
      self.stateName = "error"
      self.errorCode = "player_refresh_timeout"
      self.desiredPlaying = false
      self.emitEvent(
        "refresh_failed",
        extra: ["requestId": request.requestId, "error": self.errorCode])
      self.emit()
    }
    refreshTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
    emitEvent(
      "refresh_required",
      extra: ["requestId": request.requestId, "status": status])
    emit()
    return true
  }

  private func failRefresh(_ request: PendingRefresh, error: String) {
    refreshTimeout?.cancel()
    refreshTimeout = nil
    pendingRefresh = nil
    stateName = "error"
    errorCode = String(error.prefix(80))
    desiredPlaying = false
    wasActuallyPlaying = false
    emitEvent(
      "refresh_failed",
      extra: ["requestId": request.requestId, "error": errorCode])
    emit()
  }

  /// 刷新链接只替换当前 item，不清空歌词/Now Playing 覆盖，并从原位置恢复。
  private func reloadCurrentItem(
    url: URL,
    headers: [String: String],
    seekTo: Double,
    autoplay: Bool,
    requestId: String
  ) {
    clearItemObservers()
    player.pause()
    player.replaceCurrentItem(with: nil)
    currentURL = url.absoluteString
    pendingSeek = seekTo.isFinite && seekTo > 0 ? seekTo : nil
    pendingAutoplay = autoplay
    desiredPlaying = autoplay
    wasActuallyPlaying = false
    hasReportedLoaded = false
    position = pendingSeek ?? 0
    stateName = "loading"
    errorCode = ""
    let nextItem = AVPlayerItem(asset: makeAsset(url: url, headers: headers))
    item = nextItem
    observeItem(nextItem)
    player.replaceCurrentItem(with: nextItem)
    emitEvent("refresh_applied", extra: ["requestId": requestId])
    emit()
  }

  @objc public func resolveRefresh(_ requestJSON: String) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let requestId = request["requestId"] as? String,
      !requestId.isEmpty
    else { return }
    DispatchQueue.main.async {
      guard
        let pending = self.pendingRefresh,
        pending.requestId == requestId
      else { return }
      self.refreshTimeout?.cancel()
      self.refreshTimeout = nil
      self.pendingRefresh = nil

      let error = self.metadataText(request["error"], limit: 80)
      if !error.isEmpty {
        self.failRefresh(pending, error: error)
        return
      }
      guard
        let rawURL = request["url"] as? String,
        let url = self.httpURL(rawURL)
      else {
        self.failRefresh(pending, error: "player_refresh_invalid")
        return
      }
      let headers = Self.parseHeaders(request["headers"])
      let artwork = (request["artwork"] as? String).flatMap { self.httpURL($0) }
      guard
        pending.queueIndex >= 0,
        pending.queueIndex < self.queue.count,
        self.queue[pending.queueIndex].url.absoluteString == pending.url
      else {
        self.failRefresh(pending, error: "player_refresh_stale")
        return
      }
      self.queue[pending.queueIndex].url = url
      self.queue[pending.queueIndex].headers = headers
      if let artwork {
        self.queue[pending.queueIndex].artwork = artwork
      }
      if
        self.queueIndex == pending.queueIndex,
        self.currentURL == pending.url
      {
        if let artwork {
          self.currentArtworkURL = artwork
          let key = artwork.absoluteString
          self.currentArtwork = self.artworkCache[key]
          if self.currentArtwork == nil {
            self.loadArtwork(url: artwork, key: key)
          }
        }
        self.reloadCurrentItem(
          url: url,
          headers: headers,
          seekTo: pending.position,
          autoplay: pending.shouldPlay,
          requestId: pending.requestId)
      } else {
        self.emitEvent(
          "refresh_applied",
          extra: ["requestId": pending.requestId])
        self.emit()
      }
    }
  }

  private func tick(_ time: CMTime) {
    let seconds = CMTimeGetSeconds(time)
    if seconds.isFinite && seconds >= 0 {
      position = seconds
      updateLyric(at: seconds)
    }
    guard stateName != "error", stateName != "ended" else {
      emit()
      return
    }
    let actualPlaying = player.timeControlStatus == .playing
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
    if actualPlaying && !wasActuallyPlaying {
      wasActuallyPlaying = true
      refreshAttempts = 0
      emitEvent("started")
    } else if !actualPlaying && wasActuallyPlaying {
      wasActuallyPlaying = false
      if stateName == "paused" {
        emitEvent("paused")
      } else if stateName == "loading" {
        emitEvent("waiting")
      }
    }
    emit()
  }

  private func payload() -> [String: Any] {
    [
      "state": stateName,
      "url": eventURL(currentURL),
      "position": position.isFinite ? position : 0,
      "duration": duration.isFinite ? duration : 0,
      "error": errorCode,
      "queueIndex": queueIndex,
      "lyric": currentLyric,
      "rate": Double(playbackRate),
      "volume": Double(player.volume),
      "engine": engineName,
      "refreshing": pendingRefresh != nil,
    ]
  }

  /// 事件里不暴露查询串中的 access_token（目前播放走 header，仍做防御）。
  private func eventURL(_ raw: String) -> String {
    guard var components = URLComponents(string: raw) else { return raw }
    let sensitive = ["access_token", "refresh_token", "token", "authorization"]
    components.queryItems = components.queryItems?.filter {
      !sensitive.contains($0.name.lowercased())
    }
    return components.url?.absoluteString ?? raw
  }

  private func emitEvent(
    _ type: String,
    extra: [String: Any] = [:]
  ) {
    guard let context else { return }
    var value: [String: Any] = [
      "type": type,
      "url": eventURL(currentURL),
      "queueIndex": queueIndex,
      "title": currentTitle,
      "artist": currentArtist,
      "album": currentAlbum,
      "position": position.isFinite ? position : 0,
      "duration": duration.isFinite ? duration : 0,
    ]
    for (key, item) in extra {
      value[key] = item
    }
    context.sendGlobalEvent("PomeloPlayer.event", withParams: [value])
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
    var displayTitle = currentTitle
    var displayArtist = currentArtist
    var displayAlbum = currentAlbum
    if !currentLyric.isEmpty {
      switch lyricMode {
      case "artist": displayArtist = currentLyric
      case "album": displayAlbum = currentLyric
      default: displayTitle = currentLyric
      }
    }
    if !overrideTitle.isEmpty { displayTitle = overrideTitle }
    if !overrideArtist.isEmpty { displayArtist = overrideArtist }
    if !overrideAlbum.isEmpty { displayAlbum = overrideAlbum }
    let fallbackTitle = URL(string: currentURL)?.lastPathComponent ?? "Pomelo Audio"
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: displayTitle.isEmpty ? fallbackTitle : displayTitle,
      MPMediaItemPropertyArtist: displayArtist,
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: stateName == "playing" ? Double(playbackRate) : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if !displayAlbum.isEmpty {
      info[MPMediaItemPropertyAlbumTitle] = displayAlbum
    }
    let lyricText = !overrideLyrics.isEmpty
      ? overrideLyrics : lyricLines.map(\.text).joined(separator: "\n")
    if !lyricText.isEmpty {
      info[MPMediaItemPropertyLyrics] = lyricText
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

  @objc public func load(_ requestJSON: String, callback: @escaping (String) -> Void) {
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
    let headers = Self.parseHeaders(request["headers"])
    DispatchQueue.main.async {
      self.load(url: url, autoplay: autoplay, headers: headers, callback: callback)
    }
  }

  @objc public func setQueue(_ requestJSON: String) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let rawItems = request["items"] as? [[String: Any]],
      rawItems.count <= Self.maxQueueItems
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
          artwork: (raw["artwork"] as? String).flatMap { httpURL($0) },
          headers: Self.parseHeaders(raw["headers"])
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

  @objc public func next() {
    DispatchQueue.main.async {
      guard self.queueIndex + 1 < self.queue.count else { return }
      self.loadQueueItem(self.queueIndex + 1)
    }
  }

  @objc public func previous() {
    DispatchQueue.main.async {
      guard self.queueIndex > 0 else {
        self.seek(0)
        return
      }
      self.loadQueueItem(self.queueIndex - 1)
    }
  }

  @objc public func play() {
    DispatchQueue.main.async {
      guard self.item != nil else { return }
      self.desiredPlaying = true
      self.player.rate = self.playbackRate
      self.stateName = "playing"
      if self.pendingRefresh != nil {
        self.pendingRefresh?.shouldPlay = true
      }
      self.emit()
    }
  }

  @objc public func pause() {
    DispatchQueue.main.async {
      self.player.pause()
      self.desiredPlaying = false
      self.wasActuallyPlaying = false
      if self.pendingRefresh != nil {
        self.pendingRefresh?.shouldPlay = false
      }
      if self.item != nil {
        self.stateName = "paused"
        self.emitEvent("paused")
      }
      self.emit()
    }
  }

  @objc public func seek(_ seconds: Double) {
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

  @objc public func stop() {
    DispatchQueue.main.async {
      self.player.pause()
      self.player.replaceCurrentItem(with: nil)
      self.clearItemObservers()
      self.cancelPendingRefresh()
      self.item = nil
      self.currentURL = ""
      self.currentTitle = ""
      self.currentArtist = ""
      self.currentAlbum = ""
      self.currentArtworkURL = nil
      self.currentArtwork = nil
      self.artworkLoadingKey = ""
      self.lyricLines = []
      self.currentLyric = ""
      self.overrideTitle = ""
      self.overrideArtist = ""
      self.overrideAlbum = ""
      self.overrideLyrics = ""
      self.stateName = "idle"
      self.position = 0
      self.duration = 0
      self.errorCode = ""
      self.queueIndex = -1
      self.desiredPlaying = false
      self.wasActuallyPlaying = false
      self.hasReportedLoaded = false
      self.pendingSeek = nil
      self.pendingAutoplay = false
      self.refreshAttempts = 0
      self.emitEvent("stopped")
      self.emit()
      try? AVAudioSession.sharedInstance().setActive(
        false, options: .notifyOthersOnDeactivation)
    }
  }

  @objc public func setLyrics(_ requestJSON: String) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let rawLines = request["lines"] as? [[String: Any]],
      rawLines.count <= 5000
    else { return }
    var lines: [LyricLine] = []
    for raw in rawLines {
      guard
        let rawTime = raw["time"] as? NSNumber,
        let text = raw["text"] as? String
      else { continue }
      let time = rawTime.doubleValue
      guard time.isFinite, time >= 0 else { continue }
      let clean = String(text.prefix(240))
      if clean.isEmpty { continue }
      lines.append(LyricLine(time: time, text: clean))
    }
    lines.sort { $0.time < $1.time }
    let rawMode = request["mode"] as? String ?? "title"
    let mode = ["title", "artist", "album"].contains(rawMode) ? rawMode : "title"
    DispatchQueue.main.async {
      self.lyricMode = mode
      self.lyricLines = lines
      self.currentLyric = ""
      self.updateLyric(at: self.position)
      self.updateNowPlaying()
      self.emit()
    }
  }

  @objc public func clearLyrics() {
    DispatchQueue.main.async {
      self.lyricLines = []
      self.currentLyric = ""
      self.updateNowPlaying()
      self.emit()
    }
  }

  @objc public func setNowPlayingOverride(_ requestJSON: String) {
    guard
      let data = requestJSON.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return }
    let title = metadataText(request["title"])
    let artist = metadataText(request["artist"])
    let album = metadataText(request["album"])
    let lyrics = String((request["lyrics"] as? String ?? "").prefix(4000))
    DispatchQueue.main.async {
      self.overrideTitle = title
      self.overrideArtist = artist
      self.overrideAlbum = album
      self.overrideLyrics = lyrics
      self.updateNowPlaying()
    }
  }

  @objc public func clearNowPlayingOverride() {
    DispatchQueue.main.async {
      self.overrideTitle = ""
      self.overrideArtist = ""
      self.overrideAlbum = ""
      self.overrideLyrics = ""
      self.updateNowPlaying()
    }
  }

  @objc public func setRate(_ rate: Double) {
    guard rate.isFinite, rate >= 0.1, rate <= 4.0 else { return }
    DispatchQueue.main.async {
      self.playbackRate = Float(rate)
      if self.stateName == "playing" { self.player.rate = self.playbackRate }
      self.emit()
    }
  }

  @objc public func setVolume(_ volume: Double) {
    guard volume.isFinite, volume >= 0.0, volume <= 1.0 else { return }
    DispatchQueue.main.async {
      self.player.volume = Float(volume)
      self.emit()
    }
  }

  @objc public func getCapabilities(_ callback: @escaping (String) -> Void) {
    let value: [String: Any] = [
      "engine": "system",
      "audio": true,
      "video": false,
      "rate": true,
      "volume": true,
      "background": true,
      "lyrics": true,
      "queue": true,
      "headers": true,
      "refresh": true,
      "events": true,
    ]
    guard
      let data = try? JSONSerialization.data(withJSONObject: value),
      let json = String(data: data, encoding: .utf8)
    else {
      callback(errorJSON("player_capabilities_failed"))
      return
    }
    callback(json)
  }

  @objc public func setEngine(_ engine: String, callback: @escaping (String) -> Void) {
    guard engine == "system" || engine == "avplayer" else {
      callback(errorJSON("player_engine_unsupported"))
      return
    }
    engineName = "system"
    callback("{\"ok\":true}")
  }

  private func updateLyric(at seconds: Double) {
    guard !lyricLines.isEmpty else { return }
    var text = ""
    for line in lyricLines {
      if line.time <= seconds + 0.05 { text = line.text } else { break }
    }
    guard text != currentLyric else { return }
    currentLyric = text
    updateNowPlaying()
    context?.sendGlobalEvent(
      "PomeloPlayer.lyric",
      withParams: [["text": text, "time": position]])
  }

  @objc public func getState(_ callback: @escaping (String) -> Void) {
    DispatchQueue.main.async {
      callback(self.stateJSON())
    }
  }
}
