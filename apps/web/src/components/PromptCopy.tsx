import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import './PromptCopy.css';

type CopyState = 'idle' | 'copied' | 'failed';
const LABELS: Record<CopyState, string> = {
  idle: '复制提示词',
  copied: '已复制',
  failed: '复制失败，请手动选中文字',
};

/** The full prompt a card was generated from, with a copy button. Give it a key per card. */
export default function PromptCopy({ prompt }: { prompt: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    let next: CopyState = 'copied';
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      next = 'failed';
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }
  return (
    <div className="fo-prompt-copy">
      <p className="fo-prompt-copy-text">{prompt}</p>
      <button type="button" className="fo-prompt-copy-button" onClick={() => void copy()}>
        <Icon name={state === 'copied' ? 'check' : 'copy'} />
        <span aria-live="polite">{LABELS[state]}</span>
      </button>
    </div>
  );
}
