declare module 'react-katex' {
  import type { ComponentType, ReactElement } from 'react';

  export interface MathComponentProps {
    math: string;
    errorColor?: string;
    renderError?: (error: Error) => ReactElement;
    throwOnError?: boolean;
  }

  export const InlineMath: ComponentType<MathComponentProps>;
  export const BlockMath: ComponentType<MathComponentProps>;
}

declare module 'file-saver' {
  export function saveAs(data: Blob | File | string, filename?: string): void;
}
