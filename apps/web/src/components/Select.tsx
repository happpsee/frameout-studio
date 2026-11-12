import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
type Props = {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
};
export default function Select({
  value,
  onChange,
  options,
  label,
  className = '',
  disabled,
}: Props) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 100, maxHeight: 260 });
  const variant = /duration/.test(className)
    ? 'duration'
    : /generation-mode/.test(className)
      ? 'compact'
      : undefined;
  function close(focus = false) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  function show(index?: number) {
    if (disabled || !options.length) return;
    setActive(
      index ??
        Math.max(
          0,
          options.findIndex(option => option.value === value),
        ),
    );
    setOpen(true);
  }
  function choose(index: number) {
    if (options[index]) onChange(options[index].value);
    close(true);
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect(),
      height = Math.min(260, options.length * 40 + 12);
    const below = window.innerHeight - rect.bottom - 12;
    const up = below < Math.min(160, height) && rect.top > below;
    const available = Math.max(80, up ? rect.top - 12 : below),
      maxHeight = Math.min(height, available);
    const width = Math.min(Math.max(rect.width, 130), window.innerWidth - 20);
    setPosition({
      left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)),
      top: up ? rect.top - maxHeight - 5 : rect.bottom + 5,
      width,
      maxHeight,
    });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const element = menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        close();
    };
    const reposition = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const host =
    trigger.current?.closest('dialog') || trigger.current?.closest('.fo-studio') || document.body;
  return (
    <div className={`fo-select ${className}`} data-variant={variant}>
      <button
        ref={trigger}
        type="button"
        className="fo-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            show(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : undefined);
          }
        }}
      >
        <span className="fo-select-value">
          {options.find(option => option.value === value)?.label || value}
        </span>
        <Icon className="fo-select-chevron" name="chevron-down" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="fo-select-menu"
            data-variant={variant}
            role="listbox"
            aria-label={label}
            style={{ position: 'fixed', ...position }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') close(true);
              else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                setActive(index =>
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? options.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                        options.length,
                );
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                choose(active);
              }
            }}
          >
            {options.map((option, index) => (
              <button
                type="button"
                key={option.value}
                className={`fo-select-option${active === index ? ' is-active' : ''}`}
                data-index={index}
                role="option"
                aria-selected={value === option.value}
                tabIndex={-1}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {value === option.value && <Icon className="fo-select-check" name="check" />}
              </button>
            ))}
          </div>,
          host,
        )}
    </div>
  );
}
