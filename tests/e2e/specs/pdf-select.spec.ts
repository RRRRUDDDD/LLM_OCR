import { test, expect } from '../fixtures/base-test';
import { AppPage } from '../pages/AppPage';

/**
 * Build a minimal but valid N-page PDF (blank pages) with a correct xref
 * table, so pdf.js can parse and render it without external fixtures.
 */
function buildTestPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>');
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((content, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}

test.describe('parsePageRange', () => {
  test('parses ranges, single pages and mixed separators leniently', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { parsePageRange } = await import('/src/utils/parsePageRange.ts');
      return {
        mixed: parsePageRange('1-3, 5，8；10-12', 20),
        reversed: parsePageRange('7-4', 20),
        clamped: parsePageRange('0-2, 18-99', 20),
        garbage: parsePageRange('abc, 3, x-y, 5-x', 20),
        empty: parsePageRange('  ', 20),
      };
    });

    expect(result.mixed).toEqual([1, 2, 3, 5, 8, 10, 11, 12]);
    expect(result.reversed).toEqual([4, 5, 6, 7]);
    expect(result.clamped).toEqual([1, 2, 18, 19, 20]);
    expect(result.garbage).toEqual([3]);
    expect(result.empty).toEqual([]);
  });
});

test.describe('PDF page selection dialog', () => {
  test.beforeEach(async ({ page }) => {
    // Keep OCR traffic off the network — pages will just end in error state.
    await page.route('**/chat/completions', (route) => route.abort());
  });

  test('shows thumbnails with all pages selected, supports batch tools and partial extraction', async ({ page }) => {
    const app = new AppPage(page);
    await app.uploadFile({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: buildTestPdf(4) } as never);

    const dialog = page.locator('.pdf-select-dialog');
    await expect(dialog).toBeVisible();

    // All 4 thumbnails render and start selected
    const thumbs = dialog.locator('.pdf-select-page');
    await expect(thumbs).toHaveCount(4);
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(4);
    await expect(dialog.locator('.pdf-select-dialog__desc')).toContainText(/4 \/ 4|已选 4 \/ 4/);

    // Batch tools: clear → odd pages (1, 3) → invert (2, 4)
    await dialog.getByRole('button', { name: /清空|None/ }).click();
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(0);

    await dialog.getByRole('button', { name: /奇数页|Odd/ }).click();
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(2);

    await dialog.getByRole('button', { name: /反选|Invert/ }).click();
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(2);

    // Range input replaces the selection
    await dialog.locator('.pdf-select-dialog__range-input').fill('1-3');
    await dialog.getByRole('button', { name: /应用|Apply/ }).click();
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(3);

    // Confirm → only the 3 selected pages are extracted and queued
    await dialog.getByRole('button', { name: /识别选中|Recognize/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.page-thumbnails-strip .page-thumbnail')).toHaveCount(3);
  });

  test('always-on preview pane follows clicks and pages with arrow keys', async ({ page }) => {
    const app = new AppPage(page);
    await app.uploadFile({ name: 'preview.pdf', mimeType: 'application/pdf', buffer: buildTestPdf(4) } as never);

    const dialog = page.locator('.pdf-select-dialog');
    await expect(dialog.locator('.pdf-select-page')).toHaveCount(4);

    // Preview is visible by default, showing page 1 — no zoom click needed
    const preview = page.locator('.pdf-select-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.pdf-select-preview__indicator')).toContainText(/1 \/ 4/);
    await expect(preview.locator('.pdf-select-preview__body img')).toBeVisible();

    // Clicking a thumbnail toggles its selection AND focuses it in the preview
    await dialog.locator('.pdf-select-page').nth(1).click();
    await expect(preview.locator('.pdf-select-preview__indicator')).toContainText(/2 \/ 4/);
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(3);
    await expect(dialog.locator('.pdf-select-page--current')).toHaveCount(1);

    // Arrow keys page the preview through the document
    await page.keyboard.press('ArrowDown');
    await expect(preview.locator('.pdf-select-preview__indicator')).toContainText(/3 \/ 4/);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(preview.locator('.pdf-select-preview__indicator')).toContainText(/1 \/ 4/);
    await expect(preview.getByRole('button', { name: /上一页|Previous/ })).toBeDisabled();

    // Toggling selection from the preview header updates the grid
    await preview.getByRole('button', { name: /取消选中|Deselect/ }).click();
    await expect(preview.getByRole('button', { name: /选中此页|Select this page/ })).toBeVisible();
    await expect(dialog.locator('.pdf-select-page--selected')).toHaveCount(2);

    // ESC cancels the whole dialog (no nested preview layer anymore)
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.hero-subtitle')).toBeVisible();
  });

  test('cancelling the dialog skips the PDF entirely', async ({ page }) => {
    const app = new AppPage(page);
    await app.uploadFile({ name: 'skip.pdf', mimeType: 'application/pdf', buffer: buildTestPdf(2) } as never);

    const dialog = page.locator('.pdf-select-dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /取消|Cancel/ }).click();
    await expect(dialog).not.toBeVisible();

    // No pages were added — upload zone still in its empty state
    await expect(page.locator('.hero-subtitle')).toBeVisible();
  });
});
