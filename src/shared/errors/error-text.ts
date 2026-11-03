/**
 * 错误码 → 用户可读中文文案的唯一映射表。
 *
 * 这些码由 JS 核心链路(`src/core/**`)和原生宿主(iOS `Failure(code:)`、
 * Android `PomeloUpdateModule.errors`)抛出,是跨语言的稳定契约;页面只做
 * 查表,不再各自维护一份子集字典,也不把原始码直接显示给用户。
 *
 * 目前只覆盖中文:文案表与 i18n 的关系见 `src/i18n/index.ts` 的说明
 * (i18n 只覆盖导航/设置等骨架文案)。新增错误码时必须在这里补一条,
 * 否则 `scripts/__tests__/ui-contract.node-test.mjs` 会失败。
 */

/** Bundle 热更新与客户端更新共用的一张表:两条链路的码没有重名冲突。 */
const UPDATE_TEXT: Record<string, string> = {
  // —— 发布元数据(GitHub Release 读取)——
  release_rate_limited: '请求过于频繁,请稍后再试',
  release_unpublished: '发布尚未公开',
  release_missing_asset: '发布缺少必要资产',
  release_changed: '发布在读取过程中发生了变化',
  invalid_release: '发布信息无效',
  metadata_failed: '无法读取发布信息',
  metadata_too_large: '发布信息过大',
  metadata_unavailable: '此版本不支持安全元数据读取,请安装新版安装包',
  client_metadata_missing: '此版本未提供客户端更新信息',
  invalid_update_url: '更新地址无效',
  invalid_update_proxy: '更新代理地址无效',
  invalid_update_response: '原生更新模块返回的数据格式异常',
  update_channel_unsupported: '当前通道不支持更新检查',
  update_unavailable: '当前宿主不支持更新检查',
  update_state_unavailable: '无法读取当前更新状态',
  update_storage_unavailable: '更新缓存目录不可用,请重启后重试',
  update_busy: '已有更新任务在进行,请稍后再试',
  update_not_newer: '该版本不比当前版本更新',
  update_protocol: '更新协议版本不兼容,请安装完整安装包',
  update_timeout: '原生更新模块响应超时',
  update_failed: '更新失败,请稍后再试',

  // —— 下载 / 安装 ——
  cancelled: '已取消',
  download_failed: '下载失败,请检查网络后重试',
  checksum_mismatch: '下载内容校验失败',
  insufficient_space: '剩余空间不足',
  invalid_manifest: '更新清单无效',
  invalid_metadata_request: '更新请求参数无效',
  invalid_task: '更新任务不存在',
  invalid_signature: '更新包签名校验失败',
  unknown_signing_key: '更新包签名不受信任',
  rollback_unconfirmed: '上次启动未确认,已回退到此前版本',
  startup_failed: '上次启动失败,已回退到此前版本',

  // —— 兼容性(与 BundleCompatibility 一一对应)——
  incompatible_channel: '此更新与当前通道不匹配',
  incompatible_protocol: '此更新与当前更新协议不兼容',
  incompatible_schema: '此更新与当前本地数据结构不兼容',
  incompatible_platform: '此更新不含当前平台的产物',
  incompatible_engine: '此更新与当前 Lynx 引擎版本不匹配',
  incompatible_host: '此更新要求更高版本的客户端',
  incompatible_bridge: '此更新与当前桥接版本不兼容',
  incompatible_capability: '此更新需要当前客户端未提供的原生能力',

  // —— 客户端安装包更新 ——
  open_url_failed: '无法打开链接',
  trollstore_unavailable: '未检测到 TrollStore,请先安装或打开下载页',
};

/** Bundle 热更新兼容性原因的对照表;非 compatible 时展示给用户。 */
const BUNDLE_REASON_TEXT: Record<string, string> = {
  unavailable: '热更新不可用,请安装完整安装包',
  protocol: '热更新协议不兼容,请安装完整安装包',
  channel: '此更新与当前通道不匹配,请安装完整安装包',
  platform: '此更新不含当前平台的产物',
  engine: '此更新与当前 Lynx 引擎版本不匹配,请安装完整安装包',
  host_version: '此更新要求更高版本的客户端,请先升级安装包',
  bridge: '此更新与当前桥接版本不兼容,请安装完整安装包',
  capability: '此更新需要当前客户端未提供的原生能力',
  schema: '此更新与当前本地数据结构不兼容,请安装完整安装包',
  signing_key: '此安装包未配置受信签名密钥,无法热更新',
  signature_missing: '发布未包含签名,无法热更新',
  signature_invalid: '签名校验失败',
  /** client-updates.ts 在签名校验抛非签名类错误时回落到这个码。 */
  incompatible: '此更新与当前宿主不兼容,请安装完整安装包',
};

/** 播放器与媒体链路的错误码(原生 `PomeloPlayerModule` + JS 媒体核心)。 */
const PLAYER_TEXT: Record<string, string> = {
  player_empty_url: '请输入音频地址',
  player_invalid_url: '音频地址无效,需要 http(s) 地址',
  player_no_source: '请先加载音频',
  player_audio_session_failed: '无法启用音频播放会话',
  player_item_failed: '音频加载失败',
  player_unavailable: '当前客户端不支持音视频播放',
  player_capabilities_failed: '无法读取播放器能力',
  player_engine_unsupported: '当前 Lynx 引擎不支持音视频播放',
  player_state_failed: '无法读取播放状态',
  player_failed: '播放失败,请稍后再试',
  player_timeout: '播放器响应超时',
  player_refresh_timeout: '刷新播放链接超时',
  player_refresh_failed: '刷新播放链接失败',
  player_refresh_unavailable: '当前曲目无法刷新播放链接',
  player_refresh_invalid: '刷新后的播放地址无效',
  player_refresh_stale: '播放队列已变化,请重新播放',
  invalid_player_response: '播放器返回的数据格式异常',
  invalid_player_state: '播放状态数据异常',
};

/** 5sing 是开发者通道的第三方联调源,单独成表便于整块删除。 */
const FIVE_SING_TEXT: Record<string, string> = {
  five_sing_network: '5sing 网络请求失败',
  five_sing_timeout: '5sing 请求超时',
  five_sing_playlist_failed: '5sing 歌单读取失败',
  five_sing_media_failed: '5sing 播放地址获取失败',
  five_sing_rate_limited: '5sing 请求过于频繁,请稍后再试',
  five_sing_empty: '5sing 没有返回可播放歌曲',
  five_sing_json: '5sing 返回数据格式错误',
};

function lookup(table: Record<string, string>, code: string): string | null {
  // 只认自有字符串值。错误码可能来自原生或网络,`toString`/`constructor`
  // 之类的原型键取到的是函数,用 `typeof` 判断能一并挡掉;同时避免
  // `Object.hasOwn`(ES2022)与 `Object.prototype.hasOwnProperty.call`
  // 两种写法各自的代价:前者要求引擎/产物支持(polyfill 已关闭,
  // 见 lynx.config.ts),后者会触发 Biome 的 noPrototypeBuiltins。
  const text = table[code];
  return typeof text === 'string' ? text : null;
}

/** Bundle 热更新 / 客户端更新区的错误码文案。 */
export function updateErrorText(code: string): string {
  return lookup(UPDATE_TEXT, code) ?? '操作失败,请稍后再试';
}

/** 客户端安装包检查区的错误码文案(兜底措辞不同)。 */
export function clientUpdateErrorText(code: string): string {
  return lookup(UPDATE_TEXT, code) ?? '检查失败,请稍后再试';
}

/** Bundle 热更新不可用原因文案。 */
export function bundleReasonText(reason: string): string {
  return (
    lookup(BUNDLE_REASON_TEXT, reason) ??
    '此更新与当前宿主不兼容,请安装完整安装包'
  );
}

/** 播放器错误码文案;未登记的码原样回显,便于排查原生侧新增码。 */
export function playerErrorText(code: string): string {
  return lookup(PLAYER_TEXT, code) ?? (code || '播放失败');
}

/** 5sing 错误文案;`five_sing_http_<status>` 会拼进 HTTP 状态码。 */
export function fiveSingErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const known = lookup(FIVE_SING_TEXT, code);
  if (known) return known;
  const http = /^five_sing_http_(\d{3})$/.exec(code);
  if (http) return `5sing 接口返回 HTTP ${http[1]}`;
  return code ? `5sing 测试数据加载失败(${code})` : '5sing 测试数据加载失败';
}
