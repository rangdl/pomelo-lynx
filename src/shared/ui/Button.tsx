import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text';

export interface ButtonProps {
  label: string;
  onTap: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** 触发布局中的等宽按钮。 */
  grow?: boolean;
  testid?: string;
}

/** 统一操作按钮;disabled 时不绑定 tap,避免误触。 */
export function Button({
  label,
  onTap,
  variant = 'primary',
  disabled,
  grow,
  testid,
}: ButtonProps) {
  const classes = ['button', `button--${variant}`];
  if (grow) classes.push('button--grow');
  if (disabled) classes.push('button--disabled');
  return (
    <view
      className={classes.join(' ')}
      bindtap={disabled ? undefined : onTap}
      accessibility-element={disabled ? undefined : true}
      accessibility-label={label}
      accessibility-traits={disabled ? undefined : 'button'}
      data-testid={testid}
    >
      <text className="button__text">{label}</text>
    </view>
  );
}
