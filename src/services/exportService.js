import { saveAs } from 'file-saver';

export function generateFilename(baseName = 'ocr-result', ext = 'md') {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const sanitized = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 40);
  return `${sanitized}_${date}_${time}.${ext}`;
}

export function downloadBlob(blob, filename) {
  saveAs(blob, filename);
}

export function exportPageAsMarkdown(page) {
  const content = `# ${page.fileName}\n\n${page.ocrText || '(No OCR result)'}`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, generateFilename(page.fileName, 'md'));
}

export function exportAllAsMarkdown(pages) {
  const sections = pages.map((page, i) => {
    const header = `## Page ${i + 1}: ${page.fileName}`;
    const body = page.ocrText || '(No OCR result)';
    return `${header}\n\n${body}`;
  });
  const content = `# OCR Results\n\n${sections.join('\n\n---\n\n')}`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, generateFilename('ocr-all', 'md'));
}

export function exportPageAsText(page) {
  const blob = new Blob([page.ocrText || ''], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, generateFilename(page.fileName, 'txt'));
}

export function exportAllAsText(pages) {
  const content = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.fileName} ---\n${p.ocrText || ''}`)
    .join('\n\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, generateFilename('ocr-all', 'txt'));
}
