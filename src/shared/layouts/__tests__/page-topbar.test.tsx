import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { PageTopBar } from '../PageTopBar';

test('PageTopBar 渲染标题与返回按钮', async () => {
  const { findByText, queryByTestId } = render(
    <PageTopBar
      title="关于"
      backLabel="设置"
      onBack={() => {}}
      testid="topbar"
      backTestid="back"
    />,
  );

  expect(await findByText('关于')).toBeInTheDocument();
  expect(await findByText('‹ 设置')).toBeInTheDocument();
  expect(queryByTestId('topbar')).toBeInTheDocument();
  expect(queryByTestId('back')).toBeInTheDocument();
});

test('PageTopBar 没有 onBack 时不渲染返回按钮', () => {
  const { queryByTestId } = render(
    <PageTopBar title="设置" backTestid="back" />,
  );

  expect(queryByTestId('back')).toBeNull();
});
