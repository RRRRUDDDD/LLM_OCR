import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { test, expect } from '../fixtures/base-test';

// Draw a deterministic image in the browser so figure cropping has real pixels to work with.
async function seedPageWithImage(page: import('@playwright/test').Page, pageId: string): Promise<void> {
  await page.evaluate(async (id) => {
    // @ts-expect-error Runtime-only Vite module import inside browser context.
    const { db } = await import('/src/db/index.ts');

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(20, 30, 160, 150);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));

    const now = new Date();
    await db.saveImageWithBlob({
      id,
      fileName: `${id}.jpg`,
      fileSize: blob.size,
      fileType: 'image/jpeg',
      status: 'done',
      ocrText: '',
      createdAt: now,
      updatedAt: now,
    }, blob);
  }, pageId);
}

test.describe('Figure extraction', () => {
  test('crops valid figure markers, persists them and rewrites references', async ({ page }) => {
    await seedPageWithImage(page, 'fig-page-1');

    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { processFigureMarkers } = await import('/src/services/figureExtraction.ts');
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { db } = await import('/src/db/index.ts');

      const input = '前文段落\n\n![测试图注](figure://bbox?x1=100&y1=100&x2=900&y2=600)\n\n后文段落';
      const text = await processFigureMarkers('fig-page-1', input);
      const figures = await db.getFiguresByPageIds(['fig-page-1']);

      return {
        text,
        figureCount: figures.length,
        caption: figures[0]?.caption,
        blobSize: figures[0] ? db.toFigureBlob(figures[0]).size : 0,
      };
    });

    expect(result.figureCount).toBe(1);
    expect(result.caption).toBe('测试图注');
    expect(result.blobSize).toBeGreaterThan(0);
    expect(result.text).toMatch(/!\[测试图注\]\(figure:\/\/fig_[^)]+\)/);
    expect(result.text).toContain('前文段落');
    expect(result.text).toContain('后文段落');
  });

  test('degrades invalid bboxes to caption text without records', async ({ page }) => {
    await seedPageWithImage(page, 'fig-page-2');

    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { processFigureMarkers } = await import('/src/services/figureExtraction.ts');
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { db } = await import('/src/db/index.ts');

      // x2 < x1 → invalid; tiny area → invalid
      const input = '![坏框图注](figure://bbox?x1=900&y1=100&x2=100&y2=600)\n\n![小图](figure://bbox?x1=10&y1=10&x2=20&y2=20)';
      const text = await processFigureMarkers('fig-page-2', input);
      const figures = await db.getFiguresByPageIds(['fig-page-2']);

      return { text, figureCount: figures.length };
    });

    expect(result.figureCount).toBe(0);
    expect(result.text).not.toContain('figure://');
    expect(result.text).toContain('坏框图注');
  });
});

test.describe('EPUB export', () => {
  test('groups pages by sourceFile and legacy fileName pattern', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { groupPagesIntoBooks } = await import('/src/services/epubService.ts');

      const base = { fileSize: 0, fileType: 'image/jpeg', imageUrl: '', status: 'done', createdAt: new Date(), updatedAt: new Date() };
      const books = groupPagesIntoBooks([
        { ...base, id: 'a2', fileName: 'a.pdf - Page 2.jpg', sourceFile: 'a.pdf', pageNumber: 2, ocrText: 'A2' },
        { ...base, id: 'a1', fileName: 'a.pdf - Page 1.jpg', sourceFile: 'a.pdf', pageNumber: 1, ocrText: 'A1' },
        { ...base, id: 'b1', fileName: 'b.pdf - Page 1.jpg', ocrText: 'B1' }, // legacy: no sourceFile
        { ...base, id: 'loose', fileName: 'photo.jpg', ocrText: 'L1' },
        { ...base, id: 'empty', fileName: 'c.pdf - Page 1.jpg', sourceFile: 'c.pdf', pageNumber: 1, ocrText: '   ' },
      ], 'Loose Pages');

      return books.map((book: { title: string; pages: Array<{ id: string }> }) => ({
        title: book.title,
        pageIds: book.pages.map((p) => p.id),
      }));
    });

    expect(result).toEqual([
      { title: 'a', pageIds: ['a1', 'a2'] },
      { title: 'b', pageIds: ['b1'] },
      { title: 'Loose Pages', pageIds: ['loose'] },
    ]);
  });

  test('splits chapters at H1 headings with preamble fallback', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { splitChapters } = await import('/src/services/epubService.ts');
      return {
        withHeadings: splitChapters('引言文字\n\n# 第一章\n\n内容一\n\n# 第二章\n\n内容二', '书名'),
        withoutHeadings: splitChapters('只有正文', '书名'),
      };
    });

    expect(result.withHeadings.map((c: { title: string }) => c.title)).toEqual(['书名', '第一章', '第二章']);
    expect(result.withoutHeadings).toHaveLength(1);
    expect(result.withoutHeadings[0].title).toBe('书名');
  });

  test('exports a valid EPUB 3 archive with figures, headings and MathML', async ({ page }) => {
    await seedPageWithImage(page, 'epub-page-1');

    // Seed one cropped figure so the EPUB embeds a real image resource.
    await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { processFigureMarkers } = await import('/src/services/figureExtraction.ts');
      const text = await processFigureMarkers(
        'epub-page-1',
        '# 第一章\n\n这是公式 $E=mc^2$ 的段落。\n\n![示意图](figure://bbox?x1=100&y1=100&x2=900&y2=600)',
      );
      (window as unknown as Record<string, unknown>).__ocrText = text;
    });

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { exportAllAsEpub } = await import('/src/services/epubService.ts');
      const base = { fileSize: 0, fileType: 'image/jpeg', imageUrl: '', status: 'done', createdAt: new Date(), updatedAt: new Date() };
      const ocrText = (window as unknown as Record<string, string>).__ocrText;
      await exportAllAsEpub([
        { ...base, id: 'epub-page-1', fileName: 'mybook.pdf - Page 1.jpg', sourceFile: 'mybook.pdf', pageNumber: 1, ocrText },
      ], { untitledTitle: 'Loose', language: 'zh' });
    });

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^mybook.*\.epub$/);

    const zip = await JSZip.loadAsync(readFileSync((await download.path())!));

    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    expect(zip.file('META-INF/container.xml')).toBeTruthy();

    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:title>mybook</dc:title>');
    expect(opf).toContain('<dc:source>mybook.pdf</dc:source>');
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('properties="mathml"');
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).toMatch(/<item id="fig_[^"]+" href="images\/fig_[^"]+\.jpg" media-type="image\/jpeg"\/>/);

    // EPUB 2 fallback TOC for legacy readers
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string');
    expect(ncx).toContain('<navPoint id="navPoint-1" playOrder="1">');
    expect(ncx).toContain('第一章');
    expect(ncx).toContain('src="text/chapter-001.xhtml"');

    const chapter = await zip.file('OEBPS/text/chapter-001.xhtml')!.async('string');
    expect(chapter).toContain('<h1>第一章</h1>');
    expect(chapter).toContain('<math');
    expect(chapter).toMatch(/<figure><img src="\.\.\/images\/fig_[^"]+\.jpg" alt="示意图" ?\/><figcaption>示意图<\/figcaption><\/figure>/);

    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('第一章');

    const figureFiles = Object.keys(zip.files).filter((name) => name.startsWith('OEBPS/images/') && !zip.files[name].dir);
    expect(figureFiles).toHaveLength(1);
  });
});
