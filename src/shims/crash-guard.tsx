import { root } from '@lynx-js/react';

/**
 * 黑屏根因诊断(TanStack 死磕系列):JS 侧阶段自显示。
 *
 * ESM 静态 import 无法用 try/catch 包裹,index 顶层代码也要等所有 import
 * 评估完才执行——模块级崩溃时任何"事后"日志都来不及跑。因此:
 *
 * 1. 本模块必须是 bundle 的**第一个 import**,加载即用最原生 JSX 渲染
 *    当前阶段文本(不依赖任何第三方,只用 @lynx-js/react);
 * 2. 各关键模块顶层/函数入口调用 markStage() 覆盖渲染——真机黑屏时,
 *    屏幕上留下的就是"最后成功到达的阶段";
 * 3. 注册全局 error/unhandledrejection 兜底,能捕获的异常直接红屏显示 message。
 *
 * 正常启动时 root.render(<App />) 会覆盖本诊断屏,无感知。
 */

type Stage = string;

let current: Stage = '① crash-guard 已加载';
let scheduled = false;
let appMounted = false;

/** App 成功 commit 后由 <MarkAppMounted/>(useLayoutEffect) 调用,此后诊断屏不再绘制。 */
export function confirmAppMounted(): void {
  appMounted = true;
}

export function markStage(stage: Stage): void {
  if (stage === current) return;
  current = stage;
  // 异步出队:markStage 可能在 React render 过程中被调,同步 root.render
  // 会重入渲染。快速连续 mark 自然合并为"最终到达的阶段"。
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    if (appMounted) return;
    render();
  }, 0);
}

function render(): void {
  try {
    root.render(
      <view
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#200000',
          padding: '24px',
        }}
      >
        <text style={{ color: '#ff6666', fontSize: 20, fontWeight: 'bold' }}>
          [PomeloDiag] JS 阶段自显示
        </text>
        <text style={{ color: '#ffcccc', fontSize: 16, marginTop: '16px' }}>
          {current}
        </text>
        <text style={{ color: '#886666', fontSize: 12, marginTop: '16px' }}>
          看到本屏 = JS 线程存活;主界面黑屏 = 崩在本阶段之后。
        </text>
      </view>,
    );
  } catch (e) {
    // 诊断渲染本身失败——放弃,不遮蔽原始状态。
  }
}

function onFatal(message: string): void {
  current = `✗ 捕获异常:${message}`;
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    // 即便 App 已挂载也强制绘制:致命异常优先于应用内容。
    render();
  }, 0);
}

const g = globalThis as {
  addEventListener?: (type: string, cb: (ev: unknown) => void) => void;
};

g.addEventListener?.('error', (ev: unknown) => {
  const e = ev as { message?: string; error?: { message?: string } };
  onFatal(e?.error?.message ?? e?.message ?? JSON.stringify(ev));
});
g.addEventListener?.('unhandledrejection', (ev: unknown) => {
  const r = ev as { reason?: unknown };
  onFatal(String(r?.reason ?? ev));
});

// 模块评估成功即首绘。
render();
