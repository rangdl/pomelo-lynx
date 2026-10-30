import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { ListRow } from '../ListRow';

test('ListRow 渲染标签、值与说明', async () => {
  const { findByText } = render(
    <ListRow label="宿主" value="pomelo-host" detail="iOS 15" />,
  );

  expect(await findByText('宿主')).toBeInTheDocument();
  expect(await findByText('pomelo-host')).toBeInTheDocument();
  expect(await findByText('iOS 15')).toBeInTheDocument();
});

test('ListRow 支持自定义右侧内容且保留 testid', async () => {
  const { findByText, queryByTestId } = render(
    <ListRow label="日志" trailing={<text>自定义</text>} testid="row-logs" />,
  );

  expect(await findByText('日志')).toBeInTheDocument();
  expect(await findByText('自定义')).toBeInTheDocument();
  expect(queryByTestId('row-logs')).toBeInTheDocument();
});

test('ListRow 同时渲染右侧值和箭头', async () => {
  const { findByText } = render(
    <ListRow label="显示级别" value="信息 · info" chevron />,
  );
  expect(await findByText('信息 · info')).toBeInTheDocument();
  expect(await findByText('›')).toBeInTheDocument();
});
