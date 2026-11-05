import { createHash } from 'node:crypto';

import { describe, expect, test } from '@rstest/core';

import { sha256Hex } from '../sha256.js';

describe('sha256Hex', () => {
  test('与 Node crypto 的结果一致', () => {
    const values = [
      '',
      'abc',
      'hello world',
      '密码123',
      '🎵'.repeat(50),
      'a'.repeat(1000),
    ];
    for (const value of values) {
      expect(sha256Hex(value)).toBe(
        createHash('sha256').update(value).digest('hex'),
      );
    }
  });
});
