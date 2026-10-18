import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export interface ContextMenuAction {
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface ContextMenuAnchor {
  x: number;
  y: number;
  trigger: HTMLElement;
}

export function ContextMenu({
  anchor,
  label,
  actions,
  close,
}: {
  anchor: ContextMenuAnchor;
  label: string;
  actions: ContextMenuAction[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = ref.current!;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const scrollPositions = new Map<Element, { top: number; left: number }>();
    for (let parent = anchor.trigger.parentElement; parent; parent = parent.parentElement) {
      scrollPositions.set(parent, { top: parent.scrollTop, left: parent.scrollLeft });
    }
    const dismissOutside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const dismissAndRestoreFocus = () => {
      anchor.trigger.focus({ preventScroll: true });
      close();
    };
    const dismissOnScroll = (event: Event) => {
      const target = event.target instanceof Element ? event.target : document.documentElement;
      const initial = scrollPositions.get(target);
      // Ignore scroll events queued before the menu opened
      if (initial?.top === target.scrollTop && initial.left === target.scrollLeft) return;
      if (!ref.current?.contains(event.target as Node)) dismissAndRestoreFocus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissAndRestoreFocus);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissAndRestoreFocus);
      window.removeEventListener("blur", close);
    };
  }, [anchor, close]);

  function dismiss() {
    anchor.trigger.focus({ preventScroll: true });
    close();
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = [
          ...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home" ? 0
            : event.key === "End" ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {actions.map((action) => (
        <div key={action.label} role="none">
          {action.separator && (
            <div className="context-menu-separator" role="separator" />
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={action.disabled}
            className={action.danger ? "danger" : undefined}
            onClick={() => {
              dismiss();
              action.run();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}
