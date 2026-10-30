/**
 * 底栏图标:24×24 内联 SVG。颜色由 current-color 注入(与 Lynx 官方示例一致),
 * 因为 Lynx 的 SVG 不跟随外层 text 的 color 级联。
 */
const HOME_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3.2 2.8 11.1a1 1 0 0 0-.3.7V21h6.5v-5.5h6V21h6.5v-9.2a1 1 0 0 0-.3-.7L12 3.2z"/></svg>`;

const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42C14.47 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.5.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>`;

const PLAYER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M9 18V5l10-2v13.5a3.5 3.5 0 1 1-2-3.16V7.2L11 8.6v9.9a3.5 3.5 0 1 1-2-3.16V18z"/></svg>`;

const MORE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>`;

export type TabIconName = 'home' | 'player' | 'settings' | 'more';

interface TabIconProps {
  name: TabIconName;
  color: string;
}

export function TabIcon({ name, color }: TabIconProps) {
  const content =
    name === 'home'
      ? HOME_ICON
      : name === 'player'
        ? PLAYER_ICON
        : name === 'settings'
          ? SETTINGS_ICON
          : MORE_ICON;
  return (
    <svg
      className="nav-item__icon"
      content={content}
      current-color={color}
      accessibility-element={false}
    />
  );
}
