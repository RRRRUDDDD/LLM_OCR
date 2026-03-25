import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

// 防止格式错误的 LaTeX 导致整个面板崩溃
const KATEX_OPTIONS = { throwOnError: false, errorColor: '#B3261E' };

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
