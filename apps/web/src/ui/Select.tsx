import { useState } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import Icon from './Icon';

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
};

/**
 * The app's dropdown. Radix Select does the behaviour (keyboard, focus, placement);
 * the look comes from styles/select-control.css.
 */
export default function Select({
  value,
  onChange,
  options,
  label,
  className = '',
  disabled,
}: Props) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const variant = /duration/.test(className)
    ? 'duration'
    : /generation-mode/.test(className)
      ? 'compact'
      : undefined;
  // The menu is drawn inside the open dialog, or the studio: above it, and with its styles.
  const host = root?.closest('dialog') ?? root?.closest<HTMLElement>('.fo-studio') ?? undefined;
  return (
    <div ref={setRoot} className={`fo-select ${className}`} data-variant={variant}>
      <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
        <RadixSelect.Trigger className="fo-select-trigger" aria-label={label}>
          <span className="fo-select-value">
            <RadixSelect.Value>
              {options.find(option => option.value === value)?.label || value}
            </RadixSelect.Value>
          </span>
          <Icon className="fo-select-chevron" name="chevron-down" />
        </RadixSelect.Trigger>
        <RadixSelect.Portal container={host}>
          <RadixSelect.Content
            className="fo-select-menu"
            data-variant={variant}
            aria-label={label}
            position="popper"
            sideOffset={5}
            collisionPadding={10}
          >
            <RadixSelect.Viewport>
              {options.map(option => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className="fo-select-option"
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Icon className="fo-select-check" name="check" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
