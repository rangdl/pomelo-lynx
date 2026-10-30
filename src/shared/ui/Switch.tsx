import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  testid?: string;
}

/** iOS 风格开关:51×31 视觉 + 44px 命中区。 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  testid,
}: SwitchProps) {
  const toggle = () => {
    'background only';
    if (!disabled) onChange(!checked);
  };
  return (
    <view
      className={disabled ? 'switch-hit switch-hit--disabled' : 'switch-hit'}
      bindtap={toggle}
      accessibility-element={true}
      accessibility-label={label}
      accessibility-traits="button"
      data-testid={testid}
    >
      <view className={checked ? 'switch switch--on' : 'switch'}>
        <view className="switch__thumb" />
      </view>
    </view>
  );
}
