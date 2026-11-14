import { useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../../types';
import { promptPosition, type CardPromptPlan, type PromptAction } from './card-prompt';
import './CardPrompt.css';

type Props = {
  card: Card;
  plan: CardPromptPlan;
  /** The card's box on screen, relative to the canvas viewport. */
  box: { left: number; top: number; right: number; bottom: number };
  zoom: number;
  bounds: { width: number; bottom: number };
  barBottom?: number;
  /** A generation or a shot plan is running. */
  busy: boolean;
  onRun: (action: PromptAction, text: string) => void;
  toast: (message: string) => void;
};

/**
 * The selected card's prompt, editable where the card is: change the words and generate again
 * without going to the main prompt box. Mount with key={card.id} so each card starts from its own.
 */
export default function CardPrompt(props: Props) {
  const { card, plan, busy } = props;
  const [text, setText] = useState(plan.text);
  const panel = useRef<HTMLFormElement>(null);
  const [size, setSize] = useState({ width: 360, height: 120 });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measure = () =>
      setSize(current =>
        current.width === element.offsetWidth && current.height === element.offsetHeight
          ? current
          : { width: element.offsetWidth, height: element.offsetHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const position = promptPosition({
    card: props.box,
    zoom: props.zoom,
    size,
    bounds: props.bounds,
    barBottom: props.barBottom,
  });
  const run = (action: PromptAction) => {
    if (action.kind === 'redo' && action.unavailable) props.toast(action.unavailable);
    else if (!text.trim()) props.toast('先写下描述，再生成');
    else props.onRun(action, text.trim());
  };
  const primary = plan.actions[0];
  return (
    <form
      ref={panel}
      className={`fo-card-prompt${position.docked ? ' is-docked' : ''}`}
      style={{ left: position.left, top: position.top }}
      aria-label={`${card.name} 的提示词`}
      onSubmit={event => {
        event.preventDefault();
        if (!busy) run(primary);
      }}
    >
      {position.docked && <span className="fo-card-prompt-name">{card.name}</span>}
      <textarea
        value={text}
        rows={2}
        maxLength={4000}
        aria-label="这张素材的提示词"
        placeholder={plan.placeholder}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!busy) run(primary);
          }
        }}
      />
      <div className="fo-card-prompt-actions">
        <span>{busy ? '正在生成…' : '每次生成计费一次'}</span>
        {plan.actions.map((action, index) => (
          <button
            key={action.kind}
            type={index === 0 ? 'submit' : 'button'}
            className={index === 0 ? 'is-primary' : undefined}
            disabled={busy}
            aria-disabled={action.kind === 'redo' && Boolean(action.unavailable)}
            title={action.kind === 'redo' ? action.unavailable : undefined}
            onClick={index === 0 ? undefined : () => run(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </form>
  );
}
