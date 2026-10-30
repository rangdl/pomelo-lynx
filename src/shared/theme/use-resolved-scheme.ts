import { useEffect, useState } from '@lynx-js/react';

import {
  readSystemAppearance,
  subscribeSystemAppearance,
} from '../../native/system-appearance.js';
import { resolveTheme, useAppearanceMode } from './appearance-preference.js';

/** 当前实际明暗(system 模式会跟随宿主系统外观)。 */
export function useResolvedScheme(): 'light' | 'dark' {
  const appearanceMode = useAppearanceMode();
  const [system, setSystem] = useState(readSystemAppearance);
  useEffect(() => {
    setSystem(readSystemAppearance());
    return subscribeSystemAppearance(setSystem);
  }, []);
  return resolveTheme(appearanceMode, system.colorScheme);
}
