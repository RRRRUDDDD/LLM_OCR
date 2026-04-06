import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  Packer,
  AlignmentType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { downloadBlob, generateFilename } from './exportService';
import type { Page } from '../types/page';

function parseInlineFormatting(text: string): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // **bold**
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) {
      // *italic*
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4] }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

function textToParagraphs(text: string): Paragraph[] {
  const lines = text.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
      } as const;
      paragraphs.push(
        new Paragraph({
          heading: headingMap[level as 1 | 2 | 3] || HeadingLevel.HEADING_3,
          children: parseInlineFormatting(headingMatch[2]),
        })
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: '' })],
          border: { bottom: { style: 'single', size: 6, color: 'cccccc' } },
        })
      );
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(ulMatch[1]),
          bullet: { level: 0 },
        })
      );
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(olMatch[1]),
          numbering: { reference: 'default-numbering', level: 0 },
        })
      );
      continue;
    }

    if (!trimmed) {
      paragraphs.push(new Paragraph({ children: [] }));
      continue;
    }

    paragraphs.push(
      new Paragraph({
        children: parseInlineFormatting(trimmed),
        alignment: AlignmentType.LEFT,
      })
    );
  }

  return paragraphs;
}

export async function exportPageAsDocx(page: Page): Promise<void> {
  const paragraphs = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: page.fileName })],
    }),
    ...textToParagraphs(page.ocrText || '(No OCR result)'),
  ];

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, generateFilename(page.fileName, 'docx'));
}

export async function exportAllAsDocx(pages: Page[]): Promise<void> {
  const allParagraphs: Paragraph[] = [];

  pages.forEach((page, i) => {
    if (i > 0) {
      allParagraphs.push(
        new Paragraph({ children: [new PageBreak()] })
      );
    }

    allParagraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `Page ${i + 1}: ${page.fileName}` })],
      })
    );

    allParagraphs.push(...textToParagraphs(page.ocrText || '(No OCR result)'));
  });

  const doc = new Document({
    sections: [{ children: allParagraphs }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, generateFilename('ocr-all', 'docx'));
}
