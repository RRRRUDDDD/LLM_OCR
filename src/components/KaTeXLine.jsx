import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

// Prevent malformed LaTeX from crashing the entire panel
const KATEX_OPTIONS = { throwOnError: false, errorColor: '#B3261E' };

/**
 * Renders a single text line with KaTeX math support.
 * This component is lazy-loaded so that the katex bundle (~330KB)
 * is only fetched when math content ($...$) is actually present.
 */
export default function KaTeXLine({ line }) {
  return line.split(/(\$\$.*?\$\$|\$.*?\$)/g).map((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return (
        <span key={i} className="latex-block-wrapper">
          <BlockMath math={part.slice(2, -2)} {...KATEX_OPTIONS} />
        </span>
      );
    } else if (part.startsWith('$') && part.endsWith('$') && part.length > 1) {
      return (
        <span key={i} className="latex-inline">
          <InlineMath math={part.slice(1, -1)} {...KATEX_OPTIONS} />
        </span>
      );
    }
    return part;
  });
}
