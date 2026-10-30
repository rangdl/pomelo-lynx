import { useState } from '@lynx-js/react';

import { Hint } from './Hint.js';
import './TextField.css';

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string | null;
  onFocus?: () => void;
  onBlur?: () => void;
  onConfirm?: () => void;
  maxlength?: number;
  disabled?: boolean;
  /** 外部值异步加载/重置后用它强制同步原生 input。 */
  inputKey?: string;
  testid?: string;
  className?: string;
}

/**
 * 统一输入框:边框/focus、键盘避让、Lynx 内联样式都在这里。
 * 页面只传 value/onChange,不要再手写 input frame。
 */
export function TextField({
  value,
  onChange,
  placeholder,
  label,
  hint,
  error,
  onFocus,
  onBlur,
  onConfirm,
  maxlength = 1000,
  disabled,
  inputKey,
  testid,
  className,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <view className={`text-field${className ? ` ${className}` : ''}`}>
      {label ? <text className="text-field__label">{label}</text> : null}
      <view
        className={`text-field__frame${
          focused ? ' text-field__frame--focused' : ''
        }${error ? ' text-field__frame--invalid' : ''}${
          disabled ? ' text-field__frame--disabled' : ''
        }`}
      >
        <input
          key={inputKey}
          default-value={value}
          placeholder={placeholder}
          placeholder-class="text-field__placeholder"
          maxlength={maxlength}
          disabled={disabled}
          avoid-keyboard={true}
          avoid-keyboard-spacing="12px"
          set-soft-input-mode="resize"
          style={{
            flex: 1,
            fontSize: 'var(--font-note)',
            paddingLeft: '10px',
            paddingRight: '10px',
            height: '38px',
            backgroundColor: 'transparent',
            color: 'var(--color-on-surface)',
          }}
          bindinput={(event: { detail: { value: string } }) => {
            'background only';
            onChange(event.detail.value);
          }}
          bindfocus={() => {
            'background only';
            setFocused(true);
            onFocus?.();
          }}
          bindblur={() => {
            'background only';
            setFocused(false);
            onBlur?.();
          }}
          bindconfirm={() => {
            'background only';
            onConfirm?.();
          }}
          data-testid={testid}
        />
      </view>
      {error ? (
        <Hint tone="error" inset={false}>
          {error}
        </Hint>
      ) : hint ? (
        <Hint tone="caption" inset={false}>
          {hint}
        </Hint>
      ) : null}
    </view>
  );
}
