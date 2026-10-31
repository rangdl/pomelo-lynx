import { createHash } from 'node:crypto';

import { describe, expect, test } from '@rstest/core';

import { fiveSingSignature } from '../five-sing.js';
import { md5Hex } from '../md5.js';

describe('md5Hex', () => {
  test('与 Node crypto 的结果一致', () => {
    const values = [
      '',
      'abc',
      'message digest',
      '中文签名',
      '🎵'.repeat(40),
      'a'.repeat(1000),
    ];
    for (const value of values) {
      expect(md5Hex(value)).toBe(createHash('md5').update(value).digest('hex'));
    }
  });

  test('5sing 签名固定向量', () => {
    expect(fiveSingSignature(2239736, 'yc', 1700000000000)).toBe(
      '528ddb2e3000e909e561a9a4cd6f7ca0',
    );
  });
});
