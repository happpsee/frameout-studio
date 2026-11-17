import { useRef, useState, type KeyboardEvent } from 'react';
import type { Card } from '../../types';
import { typedMention } from './mentions';

type Option = { name: string; card: Card; index: number };

/**
 * Typing "@" in a prompt lists the reference images; picking one writes "@name" at the caret.
 * Also lets other controls (a thumbnail click) insert a mention.
 */
export function useMentions(
  text: string,
  setText: (text: string) => void,
  names: string[],
  cards: Card[],
) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const typing = typedMention(text, caret);
  const options: Option[] = typing
    ? names
        .map((name, index) => ({ name, card: cards[index], index }))
        .filter(option => option.name.includes(typing.query))
    : [];
  const open = !closed && options.length > 0;

  const insert = (name: string, from = caret, to = caret) => {
    const next = `${text.slice(0, from)}@${name} ${text.slice(to)}`;
    const at = from + name.length + 2;
    setText(next);
    setCaret(at);
    setClosed(false);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(at, at);
    });
  };
  const pick = (option: Option) => typing && insert(option.name, typing.start, caret);
  /** True when the key was the menu's, so the field should not act on it. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(current => (current + step + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') pick(options[active] ?? options[0]);
    else if (event.key === 'Escape') setClosed(true);
    else return false;
    event.preventDefault();
    return true;
  };
  /** Follows the caret; the highlighted option resets only when the caret really moved. */
  const track = () => {
    const at = field.current?.selectionStart ?? text.length;
    if (at === caret) return;
    setCaret(at);
    setClosed(false);
    setActive(0);
  };
  const menu = open ? (
    <ul className="fo-mention-menu" role="listbox" aria-label="引用参考图">
      {options.map((option, index) => (
        <li
          key={option.card.id}
          role="option"
          aria-selected={index === active}
          // Keep focus in the field, so the caret stays where the mention goes.
          onMouseDown={event => {
            event.preventDefault();
            pick(option);
          }}
        >
          <img src={option.card.poster || option.card.src} alt="" />
          <b>图{option.index + 1}</b>
          <span>@{option.name}</span>
        </li>
      ))}
    </ul>
  ) : null;
  return { field, menu, onKeyDown, track, insert: (name: string) => insert(name) };
}
