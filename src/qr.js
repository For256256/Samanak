import jpeg from 'jpeg-js';
import jsQR from 'jsqr';

/**
 * رمزگشایی QR از تصویر JPEG (عکسی که ادمین از بلیت می‌فرستد).
 * خروجی: متن داخل QR یا null.
 */
export function decodeQrFromJpeg(buffer) {
  let img;
  try {
    img = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
  } catch {
    return null;
  }
  if (!img?.data || !img.width || !img.height) return null;

  // jsQR هر دو حالت را امتحان می‌کند تا با عکس‌های آینه‌ای/چرخیده هم کار کند
  for (const attempt of ['dontInvert', 'attemptBoth']) {
    const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height, {
      inversionAttempts: attempt,
    });
    if (res?.data) return res.data;
  }
  return null;
}

/**
 * استخراج کد رهگیری از محتوای QR یا متن دستی.
 * سه قالب پشتیبانی می‌شود:
 *   - لینک عمیق:  https://t.me/<bot>?start=v_ABC123
 *   - JSON نسخه قدیمی بلیت‌ها: {"c":"ABC123", ...}
 *   - خود کد رهگیری به‌صورت خام
 * خروجی: کد با حروف بزرگ یا null.
 */
export function parseVoucherPayload(text) {
  if (!text) return null;
  const raw = String(text).trim();

  // لینک عمیق
  const deep = raw.match(/[?&]start=v_([A-Za-z0-9-]{4,32})/);
  if (deep) return deep[1].toUpperCase();

  // JSON بلیت‌های صادرشده پیش از این نسخه
  if (raw.startsWith('{')) {
    try {
      const code = JSON.parse(raw)?.c;
      if (code) return String(code).trim().toUpperCase();
    } catch {
      // ادامه: شاید کد خام باشد
    }
  }

  // کد خام
  const bare = raw.match(/^v_?([A-Za-z0-9-]{4,32})$/) || raw.match(/^([A-Za-z0-9-]{4,32})$/);
  return bare ? bare[1].toUpperCase() : null;
}
