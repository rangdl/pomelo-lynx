import './Hint.css';

export type HintTone = 'caption' | 'error' | 'muted' | 'warning';

/** 统一说明/错误文本;不要在页面里再写 note/error 字号和 padding。 */
export function Hint({
  children,
  tone = 'muted',
  testid,
  inset = true,
}: {
  children: string;
  tone?: HintTone;
  testid?: string;
  inset?: boolean;
}) {
  return (
    <text
      className={`hint hint--${tone}${inset ? '' : ' hint--flush'}`}
      data-testid={testid}
    >
      {children}
    </text>
  );
}
