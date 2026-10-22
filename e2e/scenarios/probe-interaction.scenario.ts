/**
 * Interaction scenario: drives the probe page's stateful controls.
 *
 * This is the part the geometry diff cannot cover — the existing
 * `e2e/alignment/diff.py` compares snapshots, while this asserts that
 * ReactLynx state actually reacts to taps.
 */

import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';

import { createDriver, type E2EDriver } from '../driver/index.js';

describe('探针交互', () => {
  let driver: E2EDriver;

  beforeAll(async () => {
    driver = await createDriver();
    await driver.launch();
    await driver.open(process.env.E2E_BUNDLE ?? 'probe.web.bundle');
  });

  afterAll(async () => {
    await driver.teardown();
  });

  test('初始计数为 0', async () => {
    const text = await driver.query('probe-count').then((el) => el.getText());
    expect(text.trim()).toBe('count: 0');
  });

  test('点击 +1 后计数递增', async () => {
    const button = await driver.query('probe-btn-inc');

    await button.tap();
    await driver.waitFor(async () => {
      const text = await driver.query('probe-count').then((el) => el.getText());
      return text.trim() === 'count: 1';
    });

    await button.tap();
    await driver.waitFor(async () => {
      const text = await driver.query('probe-count').then((el) => el.getText());
      return text.trim() === 'count: 2';
    });
  });

  test('点击 toggle 后受控节点消失', async () => {
    expect(await driver.queryAll('probe-toggle-box')).toHaveLength(1);

    const toggle = await driver.query('probe-btn-toggle');
    await toggle.tap();

    await driver.waitFor(async () => {
      return (await driver.queryAll('probe-toggle-box')).length === 0;
    });
  });

  test('运行期间无非预期控制台错误', async () => {
    const errors = await driver.getConsoleErrors();
    expect(errors).toEqual([]);
  });
});
