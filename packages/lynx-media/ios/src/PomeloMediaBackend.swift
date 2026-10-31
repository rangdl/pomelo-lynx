import Foundation

/**
 * 播放后端协议。
 *
 * 当前音频实现仍由 `PomeloPlayerModule` 直接驱动 AVPlayer;后续 MPV 后端
 * 按此协议接入即可,JS 侧的 load/play/seek/rate/volume 不需要改。
 * 视频 Surface 另行实现,不复用音频的 Now Playing/歌词逻辑。
 */
protocol PomeloMediaBackend: AnyObject {
  var position: Double { get }
  var duration: Double { get }
  var capabilities: [String: Any] { get }

  func load(url: URL, headers: [String: String], autoplay: Bool)
  func play()
  func pause()
  func seek(_ seconds: Double)
  func stop()
  func setRate(_ rate: Float)
  func setVolume(_ volume: Float)
}
