import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { HomePage } from '../features/home/HomePage';

test('HomePage', async () => {
  const { findByText } = render(<HomePage />);
  const element = await findByText('Tap the logo and have fun!');

  expect(element).toBeInTheDocument();
});
