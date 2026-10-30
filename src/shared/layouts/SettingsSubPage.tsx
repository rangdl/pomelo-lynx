import type { ReactNode } from '@lynx-js/react';

import { PageTopBar } from './PageTopBar.js';
import './SettingsScaffold.css';

/** 标准滚动子页:根 view + PageTopBar + scroll-view + 尾部 spacer。 */
export function SettingsSubPage({
  title,
  backLabel,
  onBack,
  testid,
  topbarTestid,
  backTestid,
  scrollTestid,
  children,
}: {
  title: string;
  backLabel?: string;
  onBack: () => void;
  testid?: string;
  topbarTestid?: string;
  backTestid?: string;
  scrollTestid?: string;
  children: ReactNode;
}) {
  return (
    <view className="settings" data-testid={testid}>
      <PageTopBar
        title={title}
        backLabel={backLabel}
        onBack={onBack}
        testid={topbarTestid}
        backTestid={backTestid}
      />
      <scroll-view
        className="settings__scroll"
        scroll-orientation="vertical"
        data-testid={scrollTestid}
      >
        {children}
        <PageTail />
      </scroll-view>
    </view>
  );
}

/** 根 tab 页的大标题;必须在滚动区外。 */
export function SettingsLargeTitle({ title }: { title: string }) {
  return (
    <view className="settings__header">
      <text className="settings__title">{title}</text>
    </view>
  );
}

/** 滚动页尾部留白:84px + 底部安全区,不要在各页面重复写。 */
export function PageTail() {
  return <view className="settings__tail" data-testid="page-tail" />;
}
