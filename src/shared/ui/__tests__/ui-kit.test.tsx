import '@testing-library/jest-dom';
import { render } from '@lynx-js/react/testing-library';
import { expect, test } from '@rstest/core';

import { Button } from '../Button';
import { IconBadge } from '../IconBadge';
import { ListRow } from '../ListRow';
import { PaletteSwatches } from '../PaletteSwatches';
import { Switch } from '../Switch';
import { TextField } from '../TextField';

test('UI primitives render without business CSS', async () => {
  const switchView = render(
    <Switch checked={false} onChange={() => {}} label="自动更新" testid="sw" />,
  );
  expect(switchView.queryByTestId('sw')).toBeInTheDocument();

  const field = render(
    <TextField
      value="https://gh-proxy.org"
      onChange={() => {}}
      label="代理地址"
      testid="field"
    />,
  );
  expect(await field.findByText('代理地址')).toBeInTheDocument();
  expect(field.queryByTestId('field')).toBeInTheDocument();

  const button = render(<Button label="连接" onTap={() => {}} />);
  expect(await button.findByText('连接')).toBeInTheDocument();

  const icon = render(<IconBadge glyph="⌂" tone="azure" />);
  expect(await icon.findByText('⌂')).toBeInTheDocument();

  const swatches = render(<PaletteSwatches size="lg" />);
  expect(swatches.container).toBeTruthy();

  const row = render(<ListRow label="客户端" iconGlyph="⌂" iconTone="azure" />);
  expect(await row.findByText('⌂')).toBeInTheDocument();
});
