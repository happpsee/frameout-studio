import type { Provider } from '../types';
import { hasModelList, modelOptions, type ModelKind } from '../lib/model-options';
import Select from './Select';

/** Picks a model from the provider's list; the compatible endpoint keeps a free-text name. */
export default function ModelField({
  id,
  label,
  provider,
  kind,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  provider: Provider;
  kind: ModelKind;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (!hasModelList(provider))
    return (
      <input
        id={id}
        aria-label={label}
        value={value}
        placeholder="填写服务商提供的模型名称"
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      />
    );
  return (
    <Select
      className="fo-model-select"
      label={label}
      value={value}
      options={modelOptions(provider, kind, value)}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
