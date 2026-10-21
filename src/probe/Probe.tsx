import { useCallback, useState } from '@lynx-js/react';

import './Probe.css';

/**
 * 对齐探针页面
 *
 * 目的:在 Android / iOS / Desktop / Web 各端 Explorer 上加载同一份 bundle,
 * 用 agent-lynx snapshot / get style / screenshot 采集结构化数据后做数值 diff。
 *
 * 规约:
 * - 每个被测节点都带 `data-testid`,格式 `probe-<名称>`,作为跨端稳定寻址锚点。
 * - 布局值全部使用固定 px(不用百分比/vh),让各端几何可以直接数值对比。
 * - 状态切换按钮让 agent 可以在每端复现同一交互序列再对齐状态。
 */
export function Probe() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);

  const onInc = useCallback(() => {
    'background only';
    setCount((c) => c + 1);
  }, []);

  const onToggle = useCallback(() => {
    'background only';
    setVisible((v) => !v);
  }, []);

  return (
    <scroll-view scroll-orientation="vertical" className="ProbeRoot">
      {/* 1. 线性布局(主轴/交叉轴) */}
      <view className="Section" data-testid="probe-row">
        <view className="RowBox" data-testid="probe-row-a" />
        <view className="RowBox RowBox--tall" data-testid="probe-row-b" />
        <view className="RowBox" data-testid="probe-row-c" />
      </view>

      {/* 2. 线性布局:纵向 + 均分 */}
      <view className="Column" data-testid="probe-column">
        <view className="ColBox" data-testid="probe-col-a" />
        <view className="ColBox ColBox--grow" data-testid="probe-col-b" />
      </view>

      {/* 3. 文本:嵌套、样式继承、行高 */}
      <view data-testid="probe-text">
        <text className="TextLg">Lynx Probe 文字 Aa1</text>
        <text className="TextMd">
          嵌套
          <text className="TextInline">内联</text>
          文本
        </text>
      </view>

      {/* 4. 相对/绝对定位 */}
      <view className="PositionWrap" data-testid="probe-position">
        <view className="PosAbsolute" data-testid="probe-pos-abs" />
        <view className="PosRelative" data-testid="probe-pos-rel" />
      </view>

      {/* 5. 图片渲染 */}
      <image
        src="https://lynx.cdn.example/probe.png"
        className="ProbeImage"
        data-testid="probe-image"
        placeholder="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      />

      {/* 6. 边框/圆角/背景 */}
      <view className="BorderBox" data-testid="probe-border" />

      {/* 7. 交互 + 状态:点击后读 count 文本与显隐节点 */}
      <view className="Buttons" data-testid="probe-buttons">
        <view className="Btn" bindtap={onInc} data-testid="probe-btn-inc">
          <text className="BtnText">+1</text>
        </view>
        <view className="Btn" bindtap={onToggle} data-testid="probe-btn-toggle">
          <text className="BtnText">toggle</text>
        </view>
      </view>
      <text
        className="Count"
        data-testid="probe-count"
      >{`count: ${count}`}</text>
      {visible && <view className="ToggleBox" data-testid="probe-toggle-box" />}

      {/* 8. 动画中间态由 agent-lynx CDP 的性能接口单独采集,这里不布点 */}
    </scroll-view>
  );
}
