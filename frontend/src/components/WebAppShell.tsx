import type { ReactNode } from "react";

// Native app stays unchanged; Metro selects the .web file in a browser.
export function WebAppShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}