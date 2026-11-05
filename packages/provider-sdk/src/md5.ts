/**
 * 最小 MD5 实现。
 *
 * 仅用于服务端协议要求的**非安全**摘要:Subsonic 的令牌是
 * `md5(password + salt)`(协议自有防明文方案,不是我们设计的安全边界),
 * 以及 5sing 测试接口的公开签名。**不要**把它用于新的加密或密码存储场景。
 *
 * 不能改用 `crypto.subtle.digest`:它是异步的,而这两个场景都要求在发请求前
 * 同步算出一个查询串参数;Lynx 运行时也不保证有 WebCrypto。
 */

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

const K = new Uint32Array(64);
for (let index = 0; index < 64; index += 1) {
  K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function wordHex(word: number): string {
  let output = '';
  for (let index = 0; index < 4; index += 1) {
    output += ((word >>> (index * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return output;
}

export function md5Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let index = 0; index < 4; index += 1) {
    bytes.push((bitLength >>> (index * 8)) & 0xff);
  }
  const high = Math.floor(bitLength / 0x100000000);
  for (let index = 0; index < 4; index += 1) {
    bytes.push((high >>> (index * 8)) & 0xff);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] =
        (bytes[position] |
          (bytes[position + 1] << 8) |
          (bytes[position + 2] << 16) |
          (bytes[position + 3] << 24)) >>>
        0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed: number;
      let wordIndex: number;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      b =
        (b +
          rotateLeft(
            (a + mixed + K[index] + words[wordIndex]) >>> 0,
            SHIFT[index],
          )) >>>
        0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(wordHex).join('');
}
