/**
 * Layout scenario: asserts the probe page's fixed-size geometry.
 *
 * Every value comes from `src/probe/Probe.css`, which uses fixed px on
 * purpose so the same numbers can be compared across platforms. Tolerances
 * are loose by one decimal because flex distribution rounds.
 */

import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';

import { createDriver, type E2EDriver } from '../driver/index.js';

describe('探针布局', () => {
  let driver: E2EDriver;

  beforeAll(async () => {
    driver = await createDriver();
    await driver.launch();
    await driver.open(process.env.E2E_BUNDLE ?? 'probe.web.bundle');
  });

  afterAll(async () => {
    await driver.teardown();
  });

  test('横向行盒尺寸与顺序', async () => {
    const [a, b, c] = await Promise.all([
      driver.query('probe-row-a').then((el) => el.getRect()),
      driver.query('probe-row-b').then((el) => el.getRect()),
      driver.query('probe-row-c').then((el) => el.getRect()),
    ]);

    expect(a.width).toBeCloseTo(100, 1);
    expect(a.height).toBeCloseTo(60, 1);
    expect(b.width).toBeCloseTo(100, 1);
    expect(b.height).toBeCloseTo(90, 1);
    expect(c.height).toBeCloseTo(60, 1);

    // Row direction: left to right, no overlap.
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  test('纵向列盒:flex-grow 填满剩余高度', async () => {
    const [a, b] = await Promise.all([
      driver.query('probe-col-a').then((el) => el.getRect()),
      driver.query('probe-col-b').then((el) => el.getRect()),
    ]);

    expect(a.width).toBeCloseTo(200, 1);
    expect(a.height).toBeCloseTo(50, 1);
    expect(b.width).toBeCloseTo(200, 1);
    // The column is 200px tall; the growing box takes the remaining 150px.
    expect(b.height).toBeCloseTo(150, 1);
  });

  test('绝对定位与相对定位各自生效', async () => {
    const [abs, rel] = await Promise.all([
      driver.query('probe-pos-abs').then((el) => el.getRect()),
      driver.query('probe-pos-rel').then((el) => el.getRect()),
    ]);

    expect(abs.width).toBeCloseTo(80, 1);
    expect(abs.height).toBeCloseTo(80, 1);
    expect(rel.width).toBeCloseTo(60, 1);
    expect(rel.height).toBeCloseTo(60, 1);
  });

  test('边框圆角盒与按钮尺寸', async () => {
    const [border, button] = await Promise.all([
      driver.query('probe-border').then((el) => el.getRect()),
      driver.query('probe-btn-inc').then((el) => el.getRect()),
    ]);

    expect(border.width).toBeCloseTo(150, 1);
    expect(border.height).toBeCloseTo(100, 1);
    expect(button.width).toBeCloseTo(120, 1);
    expect(button.height).toBeCloseTo(72, 1);
  });

  test('文本节点可见', async () => {
    const label = await driver.query('probe-text').then((el) => el.getText());
    expect(label).toContain('Lynx Probe');
  });
});
