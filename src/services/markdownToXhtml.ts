import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

export interface MarkdownToXhtmlOptions {
  /**
   * Map an image URL to its final href. Return null to drop the image
   * (its alt text is kept as a plain paragraph instead).
   */
  resolveImageUrl?: (url: string) => string | null;
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function isWhitespaceText(node: HastNode): boolean {
  return node.type === 'text' && !(node.value || '').trim();
}

/**
 * Rewrite <img> hrefs through the resolver and upgrade standalone images
 * (a paragraph whose only content is one image) to <figure>/<figcaption> —
 * <p> may not contain <figure>, so the paragraph itself is replaced.
 */
function transformImages(tree: HastNode, resolveImageUrl: (url: string) => string | null): void {
  const visit = (node: HastNode) => {
    if (!node.children) return;

    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type === 'element' && child.tagName === 'p' && child.children) {
        const meaningful = child.children.filter((grandchild) => !isWhitespaceText(grandchild));
        const only = meaningful.length === 1 ? meaningful[0] : null;
        if (only?.type === 'element' && only.tagName === 'img') {
          const resolved = resolveImage(only);
          return resolved ? [toFigure(only)] : altTextParagraph(only);
        }
      }

      if (child.type === 'element' && child.tagName === 'img') {
        const resolved = resolveImage(child);
        if (!resolved) return altTextFragment(child);
      }

      visit(child);
      return [child];
    });
  };

  const resolveImage = (img: HastNode): boolean => {
    const src = String(img.properties?.src || '');
    const resolved = resolveImageUrl(src);
    if (resolved === null) return false;
    img.properties = { ...img.properties, src: resolved };
    return true;
  };

  const toFigure = (img: HastNode): HastNode => {
    const alt = String(img.properties?.alt || '').trim();
    const children: HastNode[] = [img];
    if (alt) {
      children.push({
        type: 'element',
        tagName: 'figcaption',
        properties: {},
        children: [{ type: 'text', value: alt }],
      });
    }
    return { type: 'element', tagName: 'figure', properties: {}, children };
  };

  const altTextParagraph = (img: HastNode): HastNode[] => {
    const alt = String(img.properties?.alt || '').trim();
    if (!alt) return [];
    return [{
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value: alt }],
    }];
  };

  const altTextFragment = (img: HastNode): HastNode[] => {
    const alt = String(img.properties?.alt || '').trim();
    return alt ? [{ type: 'text', value: alt }] : [];
  };

  visit(tree);
}

/**
 * Convert OCR Markdown to an XHTML body fragment suitable for EPUB 3.
 * Math is rendered by KaTeX as pure MathML, which EPUB 3 readers support
 * natively — no fonts or stylesheets need to be bundled.
 */
export async function markdownToXhtml(markdown: string, options: MarkdownToXhtmlOptions = {}): Promise<string> {
  const { resolveImageUrl } = options;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex, { output: 'mathml' })
    .use(() => (tree: HastNode) => {
      if (resolveImageUrl) transformImages(tree, resolveImageUrl);
    })
    .use(rehypeStringify, { closeSelfClosing: true, upperDoctype: false });

  const file = await processor.process(markdown);
  return String(file);
}

export function containsMathML(xhtml: string): boolean {
  return xhtml.includes('<math');
}
