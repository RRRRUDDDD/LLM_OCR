export async function readExifOrientation(blob) {
  try {
    const buffer = await blob.slice(0, 65536).arrayBuffer();
    const view = new DataView(buffer);

    // Check JPEG SOI marker
    if (view.getUint16(0) !== 0xffd8) return 1;

    let offset = 2;
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset);
      offset += 2;

      if (marker === 0xffe1) {
        // APP1 (EXIF)
        const length = view.getUint16(offset);
        offset += 2;

        // Check "Exif\0\0" header
        const exifHeader = view.getUint32(offset);
        if (exifHeader !== 0x45786966) return 1; // Not EXIF
        offset += 6; // Skip "Exif\0\0"

        const tiffStart = offset;
        const bigEndian = view.getUint16(tiffStart) === 0x4d4d;

        const read16 = (o) => view.getUint16(o, !bigEndian);

        // Skip to IFD0
        const ifdOffset = tiffStart + (bigEndian ? view.getUint32(tiffStart + 4) : view.getUint32(tiffStart + 4, true));
        const entries = read16(ifdOffset);

        for (let i = 0; i < entries; i++) {
          const entryOffset = ifdOffset + 2 + i * 12;
          if (entryOffset + 12 > view.byteLength) break;
          const tag = read16(entryOffset);
          if (tag === 0x0112) {
            // Orientation tag
            return read16(entryOffset + 8);
          }
        }
        return 1;
      } else if ((marker & 0xff00) === 0xff00) {
        // Skip other markers
        const len = view.getUint16(offset);
        offset += len;
      } else {
        break;
      }
    }
  } catch {
    // Silently fail — treat as normal orientation
  }
  return 1;
}

/**
 * Apply EXIF orientation to an image blob via canvas.
 * Returns the corrected blob (PNG), or the original if no rotation needed.
 * @param {Blob|File} blob
 * @returns {Promise<Blob>}
 */
export async function fixExifOrientation(blob) {
  const orientation = await readExifOrientation(blob);
  if (orientation <= 1 || orientation > 8) return blob;

  const img = await createImageBitmap(blob);
  const { width, height } = img;

  // Orientations 5-8 swap width/height
  const swapDims = orientation >= 5;
  const canvasW = swapDims ? height : width;
  const canvasH = swapDims ? width : height;

  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // Apply transform based on EXIF orientation
  switch (orientation) {
    case 2: ctx.setTransform(-1, 0, 0, 1, canvasW, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, canvasW, canvasH); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, canvasH); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, canvasH, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, canvasH, canvasW); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, canvasW); break;
  }

  ctx.drawImage(img, 0, 0);
  img.close();

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}
