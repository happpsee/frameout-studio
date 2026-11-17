import { useState } from 'react';
import type { Card, Note } from '../../types';
import Icon from '../../ui/Icon';
import type { CardPromptPlan, PromptAction } from './card-prompt';
import ReferenceStrip from './ReferenceStrip';
import { formatYuan } from './pricing';
import { mentionNames } from './mentions';
import { useMentions } from './MentionMenu';
import './CardPrompt.css';

type Props = {
  card: Card;
  plan: CardPromptPlan;
  /** A generation or a shot plan is running. */
  busy: boolean;
  onRun: (action: PromptAction, text: string) => void;
  onClose: () => void;
  /** The reference images "生成图片" sends, in order; the first `global` are the project's. */
  references: { cards: Card[]; global: number; editable: boolean };
  /** Notes linked into the card: their words go before what is typed here. */
  texts: Note[];
  /** About what each kind of generation would cost now, or null when unknown. */
  prices: { image: number | null; video: number | null };
  onReorder: (ids: string[]) => void;
  onUnlink: (id: string) => void;
  toast: (message: string) => void;
};

/**
 * A card's own prompt box, hanging under the card on the canvas. Several can be open at once,
 * each keeping its own words. Mount with key={card.id} so each card starts from its own.
 */
export default function CardPrompt(props: Props) {
  const { card, plan, busy } = props;
  const [text, setText] = useState(plan.text);
  const names = mentionNames(props.references.cards, card);
  const mentions = useMentions(text, setText, names, props.references.cards);
  const run = (action: PromptAction) => {
    if (action.kind === 'redo' && action.unavailable) props.toast(action.unavailable);
    else if (!text.trim() && !props.texts.length) props.toast('先写下描述，或从文本拉线连到这里');
    else props.onRun(action, text.trim());
  };
  const primary = plan.actions[0];
  const price = (action: PromptAction) =>
    action.kind === 'image' ? props.prices.image : props.prices.video;
  return (
    <form
      // Typing and selecting text here must not drag the card or pan the canvas.
      className="fo-card-prompt nodrag nopan nowheel"
      aria-label={`${card.name} 的提示词`}
      onSubmit={event => {
        event.preventDefault();
        if (!busy) run(primary);
      }}
    >
      {plan.actions.some(action => action.kind === 'image') && (
        <ReferenceStrip
          cards={props.references.cards}
          global={props.references.global}
          editable={props.references.editable}
          onReorder={props.onReorder}
          onUnlink={props.onUnlink}
          onPick={index => mentions.insert(names[index])}
        />
      )}
      {props.texts.length > 0 && (
        <ul className="fo-card-prompt-texts" aria-label="连进来的文本">
          {props.texts.map(note => (
            <li key={note.id} title={note.text}>
              <b>{note.title || '文本'}</b>
              {note.text.trim().slice(0, 40) || '（空）'}
            </li>
          ))}
        </ul>
      )}
      <div className="fo-card-prompt-field">
        <textarea
          ref={mentions.field}
          value={text}
          rows={2}
          maxLength={4000}
          aria-label="这张素材的提示词"
          placeholder={
            props.references.cards.length
              ? `${plan.placeholder}；输入 @ 引用参考图`
              : plan.placeholder
          }
          onChange={event => {
            setText(event.target.value);
            mentions.track();
          }}
          onSelect={mentions.track}
          onKeyDown={event => {
            if (mentions.onKeyDown(event)) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!busy) run(primary);
            }
          }}
        />
        {mentions.menu}
      </div>
      <div className="fo-card-prompt-actions">
        <span title="按火山方舟价目表估算，以控制台账单为准">
          {busy ? '正在生成…' : '每次生成计费一次'}
        </span>
        {plan.actions.map((action, index) => (
          <button
            key={action.kind}
            type={index === 0 ? 'submit' : 'button'}
            className={index === 0 ? 'is-primary' : undefined}
            disabled={busy}
            aria-disabled={action.kind === 'redo' && Boolean(action.unavailable)}
            title={
              action.kind === 'redo' && action.unavailable
                ? action.unavailable
                : price(action) !== null
                  ? `预计约 ${formatYuan(price(action)!)}，以控制台账单为准`
                  : undefined
            }
            onClick={index === 0 ? undefined : () => run(action)}
          >
            {action.label}
            {price(action) !== null && (
              <small className="fo-price-tag" aria-hidden="true">
                ≈{formatYuan(price(action)!)}
              </small>
            )}
          </button>
        ))}
        <button
          type="button"
          className="fo-card-prompt-close"
          aria-label="收起输入框"
          onClick={props.onClose}
        >
          <Icon name="x" />
        </button>
      </div>
    </form>
  );
}
