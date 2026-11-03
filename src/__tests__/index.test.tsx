import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { HomePage } from '../features/home/HomePage';

test('HomePage', async () => {
  const { findByTestId, findByText } = render(<HomePage />);
  expect(await findByTestId('home-page')).toBeInTheDocument();
  // 首页不再展示 provider 信息,未连接时落到连接空状态。
  expect(await findByTestId('home-connect-empty')).toBeInTheDocument();
  expect(await findByText('连接你的音乐库')).toBeInTheDocument();
});
