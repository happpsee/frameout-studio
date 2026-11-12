import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Select from './Select';

const options = [
  { value: 'one', label: '第一个' },
  { value: 'two', label: '第二个' },
  { value: 'three', label: '第三个' },
];
afterEach(cleanup);

function Harness({
  disabled = false,
  onChange = () => {},
}: {
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState('two');
  return (
    <dialog open aria-label="设置对话框">
      <button type="button">上一个字段</button>
      <Select
        label="参数"
        disabled={disabled}
        value={value}
        onChange={next => {
          setValue(next);
          onChange(next);
        }}
        options={options}
      />
      <input aria-label="下一个字段" />
    </dialog>
  );
}

describe('React Select keyboard behavior', () => {
  it('keeps its option portal inside the dialog and returns focus after committing a keyboard choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: '参数' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const list = screen.getByRole('listbox', { name: '参数' });
    expect(list.closest('dialog')).toBe(screen.getByRole('dialog', { name: '设置对话框' }));
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '第二个' }));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('three');
    expect(trigger.textContent).toContain('第三个');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('lets Escape close only the menu without changing its current value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: '参数' });
    await user.click(trigger);
    await user.keyboard('{Home}{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('第二个');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
  });

  it('does not open when disabled, including synthetic arrow key events', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: '参数' });
    await user.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveProperty('disabled', true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on an outside click without altering the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: '参数' });
    await user.click(trigger);
    await user.click(screen.getByRole('textbox', { name: '下一个字段' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '下一个字段' }));
  });

  it('continues to the next field when tabbing out of an open menu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: '参数' }));
    await user.tab();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '下一个字段' }));
  });

  it('continues to the previous field when shift-tabbing out of an open menu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: '参数' }));
    await user.tab({ shift: true });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '上一个字段' }));
  });
});
