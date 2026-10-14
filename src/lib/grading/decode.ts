import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import type { BarcodeRead } from './rules';
import jsQR from 'jsqr';

/** Real QR/1D decoding shared by the browser and the Node scan endpoint. */
export function decodePixels(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels = 4): BarcodeRead | null {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = data[p * channels + c]!;
    rgba[p * 4 + 3] = 255;
  }
  const qr = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  if (qr?.data) return { text: qr.data, format: 'QR_CODE' };
  const gray = new Uint8ClampedArray(width * height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * channels;
    gray[p] = Math.round((data[i]! + 2 * data[i + 1]! + data[i + 2]!) / 4);
  }
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  try {
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, width, height))), hints);
    return { text: result.getText(), format: BarcodeFormat[result.getBarcodeFormat()]! };
  } catch { return null; }
  finally { reader.reset(); }
}
