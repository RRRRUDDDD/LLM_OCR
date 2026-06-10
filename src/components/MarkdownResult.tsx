import { memo, useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { db } from '../db/index';
import { isFigureUrl, FIGURE_URL_PROTOCOL } from '../services/figureExtraction';
import 'katex/dist/katex.min.css';

interface MarkdownResultProps {
  content: string;
}

// Resolves figure://{id} references (cropped book illustrations stored in
// IndexedDB) to object URLs so they render in the result preview.
function FigureImage({ src, alt }: { src?: string; alt?: string }) {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (!src || !isFigureUrl(src)) return;
    let revoked = false;
    let url = '';

    void db.figures.get(src.slice(FIGURE_URL_PROTOCOL.length)).then((figure) => {
      if (!figure || revoked) return;
      url = URL.createObjectURL(db.toFigureBlob(figure));
      setObjectUrl(url);
    });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (src && !isFigureUrl(src)) {
    return <img src={src} alt={alt} />;
  }
  if (!objectUrl) {
    return <span className="figure-placeholder">🖼 {alt || ''}</span>;
  }
  return <img src={objectUrl} alt={alt} style={{ maxWidth: '100%' }} />;
}

const MarkdownResult = memo(function MarkdownResult({ content }: MarkdownResultProps) {
  return (
    <div className="markdown-result">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => (isFigureUrl(url) ? url : defaultUrlTransform(url))}
        components={{ img: FigureImage }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownResult;
