export const isMac = /Mac/.test(navigator.platform);
export const shortcut = (key: string, shift = false) =>
  isMac ? `⌘${shift ? "⇧" : ""}${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
