import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { SettingsSubPage } from '../SettingsSubPage';

test('SettingsSubPage 统一渲染顶栏、滚动区和 PageTail', async () => {
  const { findByText, queryByTestId } = render(
    <SettingsSubPage
      title="关于"
      backLabel="设置"
      onBack={() => {}}
      testid="page"
      topbarTestid="topbar"
      backTestid="back"
    >
      <text>内容</text>
    </SettingsSubPage>,
  );
  expect(await findByText('关于')).toBeInTheDocument();
  expect(queryByTestId('page')).toBeInTheDocument();
  expect(queryByTestId('topbar')).toBeInTheDocument();
  expect(queryByTestId('back')).toBeInTheDocument();
  expect(queryByTestId('page-tail')).toBeInTheDocument();
});
