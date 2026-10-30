import type { IconTone } from './IconBadge.js';
import { ListRow } from './ListRow.js';
import { Switch } from './Switch.js';

interface SwitchRowProps {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  iconGlyph?: string;
  iconTone?: IconTone;
  testid?: string;
  switchTestid?: string;
}

/** 开关行:行本身不绑 tap,只有 44px 开关命中区响应。 */
export function SwitchRow({
  label,
  detail,
  checked,
  onChange,
  disabled,
  iconGlyph,
  iconTone,
  testid,
  switchTestid,
}: SwitchRowProps) {
  return (
    <ListRow
      label={label}
      detail={detail}
      iconGlyph={iconGlyph}
      iconTone={iconTone}
      testid={testid}
      trailing={
        <Switch
          checked={checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
          testid={switchTestid}
        />
      }
    />
  );
}
