import JSZip from 'jszip';
import { db, generateId } from '../db/index';
import { downloadBlob, generateFilename } from './exportService';
import { markdownToXhtml, containsMathML } from './markdownToXhtml';
import { FIGURE_URL_PROTOCOL } from './figureExtraction';
import type { FigureRecord, Page } from '../types/page';

export interface EpubExportOptions {
  /** Title used for pages that don't belong to a recognizable source file. */
  untitledTitle?: string;
  /** dc:language of the generated books (BCP 47). */
  language?: string;
}

interface Book {
  title: string;
  /** Raw source file name (e.g. "book.pdf"), absent for loose pages. */
  sourceFile?: string;
  pages: Page[];
}

interface Chapter {
  title: string;
  markdown: string;
}

// Legacy pages carry the source only inside fileName: "book.pdf - Page 3.jpg"
const PDF_PAGE_NAME_RE = /^(.+?)\s-\sPage\s(\d+)(?:\.\w+)?$/i;

const DOWNLOAD_STAGGER_MS = 300;

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function figureFileName(figure: FigureRecord): string {
  const ext = figure.mimeType === 'image/png' ? 'png' : 'jpg';
  return `${figure.id}.${ext}`;
}

export function groupPagesIntoBooks(pages: Page[], untitledTitle: string): Book[] {
  const books = new Map<string, Book>();
  const loosePages: Page[] = [];

  for (const page of pages) {
    if (!page.ocrText.trim() || page.status !== 'done') continue;

    let source = page.sourceFile;
    let pageNumber = page.pageNumber;
    if (!source) {
      const match = page.fileName.match(PDF_PAGE_NAME_RE);
      if (match) {
        source = match[1];
        pageNumber = pageNumber ?? Number(match[2]);
      }
    }

    if (!source) {
      loosePages.push(page);
      continue;
    }

    const entry = books.get(source) || { title: stripExtension(source), sourceFile: source, pages: [] };
    entry.pages.push({ ...page, pageNumber });
    books.set(source, entry);
  }

  for (const book of books.values()) {
    book.pages.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0) || (a.order ?? 0) - (b.order ?? 0));
  }
  // Loose images (photographed pages, single scans) become one combined book
  // in their existing display order.
  if (loosePages.length > 0) {
    books.set('', { title: untitledTitle, pages: loosePages });
  }

  return Array.from(books.values());
}

/** Split merged book Markdown into chapters at H1 headings. */
export function splitChapters(markdown: string, fallbackTitle: string): Chapter[] {
  const lines = markdown.split('\n');
  const chapters: Chapter[] = [];
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (currentTitle !== null || content) {
      chapters.push({
        title: currentTitle ?? fallbackTitle,
        markdown: currentTitle !== null ? `# ${currentTitle}\n\n${content}` : content,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentTitle = heading[1];
    } else {
      buffer.push(line);
    }
  }
  flush();

  return chapters.length > 0 ? chapters : [{ title: fallbackTitle, markdown }];
}

function chapterXhtmlDocument(title: string, body: string, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
<head>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

function navDocument(bookTitle: string, chapters: Array<{ title: string; href: string }>, language: string): string {
  const items = chapters
    .map(({ title, href }) => `<li><a href="${escapeXml(href)}">${escapeXml(title)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
<head><title>${escapeXml(bookTitle)}</title></head>
<body>
<nav epub:type="toc">
<h1>${escapeXml(bookTitle)}</h1>
<ol>
${items}
</ol>
</nav>
</body>
</html>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const BOOK_CSS = `body { line-height: 1.6; margin: 0 5%; }
h1, h2, h3 { line-height: 1.3; }
figure { margin: 1em 0; text-align: center; }
figure img { max-width: 100%; }
figcaption { font-size: 0.85em; color: #555; margin-top: 0.4em; }
table { border-collapse: collapse; margin: 1em auto; }
th, td { border: 1px solid #999; padding: 0.3em 0.6em; }
blockquote { margin: 1em 2em; color: #444; }
`;

/**
 * EPUB 2 fallback table of contents — legacy readers (Adobe Digital Editions,
 * older Kindle converters) only understand NCX, so we ship both nav.xhtml and
 * toc.ncx (pattern borrowed from yamibo_downloader).
 */
function ncxDocument(bookTitle: string, uuid: string, chapters: Array<{ title: string; href: string }>): string {
  const navPoints = chapters
    .map(({ title, href }, index) =>
      `<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(title)}</text></navLabel><content src="${escapeXml(href)}"/></navPoint>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:${uuid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
<navMap>${navPoints}</navMap>
</ncx>
`;
}

function contentOpf(
  title: string,
  language: string,
  uuid: string,
  sourceFile: string | undefined,
  chapterEntries: Array<{ id: string; href: string; hasMath: boolean }>,
  figureEntries: Array<{ id: string; href: string; mediaType: string }>,
): string {
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const chapterItems = chapterEntries
    .map(({ id, href, hasMath }) =>
      `<item id="${id}" href="${escapeXml(href)}" media-type="application/xhtml+xml"${hasMath ? ' properties="mathml"' : ''}/>`)
    .join('\n    ');
  const figureItems = figureEntries
    .map(({ id, href, mediaType }) => `<item id="${id}" href="${escapeXml(href)}" media-type="${mediaType}"/>`)
    .join('\n    ');
  const spineItems = chapterEntries.map(({ id }) => `<itemref idref="${id}"/>`).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>${sourceFile ? `
    <dc:source>${escapeXml(sourceFile)}</dc:source>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${chapterItems}
    ${figureItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>
`;
}

async function buildEpubForBook(book: Book, language: string): Promise<Blob> {
  const pageIds = book.pages.map((page) => page.id);
  const figures = await db.getFiguresByPageIds(pageIds);
  const figureById = new Map(figures.map((figure) => [figure.id, figure] as const));
  const usedFigureIds = new Set<string>();

  const resolveImageUrl = (url: string): string | null => {
    if (!url.startsWith(FIGURE_URL_PROTOCOL)) return url;
    const figureId = url.slice(FIGURE_URL_PROTOCOL.length);
    const figure = figureById.get(figureId);
    if (!figure) return null;
    usedFigureIds.add(figureId);
    return `../images/${figureFileName(figure)}`;
  };

  const merged = book.pages.map((page) => page.ocrText.trim()).join('\n\n');
  const chapters = splitChapters(merged, book.title);

  const zip = new JSZip();
  // The EPUB spec requires `mimetype` to be the first entry and uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/styles/book.css', BOOK_CSS);

  const chapterEntries: Array<{ id: string; href: string; title: string; hasMath: boolean }> = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const body = await markdownToXhtml(chapter.markdown, { resolveImageUrl });
    const href = `text/chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
    zip.file(`OEBPS/${href}`, chapterXhtmlDocument(chapter.title, body, language));
    chapterEntries.push({ id: `chapter-${i + 1}`, href, title: chapter.title, hasMath: containsMathML(body) });
  }

  const figureEntries: Array<{ id: string; href: string; mediaType: string }> = [];
  for (const figureId of usedFigureIds) {
    const figure = figureById.get(figureId)!;
    const href = `images/${figureFileName(figure)}`;
    zip.file(`OEBPS/${href}`, db.toFigureBlob(figure));
    figureEntries.push({ id: figure.id, href, mediaType: figure.mimeType || 'image/jpeg' });
  }

  zip.file('OEBPS/nav.xhtml', navDocument(book.title, chapterEntries, language));
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : generateId('uuid');
  zip.file('OEBPS/toc.ncx', ncxDocument(book.title, uuid, chapterEntries));
  zip.file('OEBPS/content.opf', contentOpf(book.title, language, uuid, book.sourceFile, chapterEntries, figureEntries));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    streamFiles: true,
  });
}

/**
 * Export OCR results as EPUB 3 books — one .epub per source PDF, plus one
 * combined book for loose images. Returns the number of books generated.
 */
export async function exportAllAsEpub(pages: Page[], options: EpubExportOptions = {}): Promise<number> {
  const { untitledTitle = 'OCR Book', language = 'zh' } = options;
  const books = groupPagesIntoBooks(pages, untitledTitle);

  for (let i = 0; i < books.length; i++) {
    const blob = await buildEpubForBook(books[i], language);
    downloadBlob(blob, generateFilename(books[i].title, 'epub'));
    // Browsers throttle bursts of programmatic downloads — stagger them.
    if (i < books.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_STAGGER_MS));
    }
  }

  return books.length;
}
