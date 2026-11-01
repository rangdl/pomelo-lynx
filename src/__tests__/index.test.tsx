import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { HomePage } from '../features/home/HomePage';

test('HomePage', async () => {
  const { findByTestId, findByText } = render(<HomePage />);
  expect(await findByTestId('home-page')).toBeInTheDocument();
  expect(await findByText('Songloft')).toBeInTheDocument();
});
