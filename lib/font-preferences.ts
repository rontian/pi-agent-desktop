import { APP_PREF_KEYS } from "./app-prefs.ts";

export type FontPreferences = { ui: string; mono: string; uiSize?: number };

export const UI_FONT_SIZE_DEFAULT = 13;
export const UI_FONT_SIZE_MIN = 12;
export const UI_FONT_SIZE_MAX = 18;

export function isUiFontSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= UI_FONT_SIZE_MIN && value <= UI_FONT_SIZE_MAX;
}

export const DEFAULT_FONTS: FontPreferences = { ui: "", mono: "" };
export const FONT_STORAGE_KEY = APP_PREF_KEYS.fonts;
export const FONT_CHANGE_EVENT = "pi-fonts-changed";

export const UI_FONT_OPTIONS = ["Segoe UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "PingFang SC"] as const;
export const MONO_FONT_OPTIONS = ["Cascadia Code", "Consolas", "JetBrains Mono", "Fira Code", "Menlo"] as const;

/** One installed family name, not an arbitrary CSS declaration or font stack. */
export function isFontFamily(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f"'\\,;:{}()<>\[\]\/]/.test(value);
}

export function isFontPreferences(value: unknown): value is FontPreferences {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && "ui" in value && "mono" in value && isFontFamily(value.ui) && isFontFamily(value.mono)
    && (!("uiSize" in value) || (typeof value.uiSize === "number" && Number.isInteger(value.uiSize)
      && value.uiSize >= 12 && value.uiSize <= 18));
}

export function applyFontPreferences(fonts: FontPreferences): void {
  const style = document.documentElement.style;
  // Adjust the Fork's five UI type tiers; chat text uses its separate size setting.
  if (typeof fonts.uiSize === "number" && Number.isInteger(fonts.uiSize)
    && fonts.uiSize >= 12 && fonts.uiSize <= 18) {
    style.setProperty("--ui-font-offset", `${fonts.uiSize - 13}px`);
  } else {
    style.removeProperty("--ui-font-offset");
  }
  for (const [property, family] of [["ui", fonts.ui], ["display", fonts.ui], ["mono", fonts.mono]]) {
    if (family) style.setProperty(`--font-${property}`, `${JSON.stringify(family)}, var(--font-${property}-default)`);
    else style.removeProperty(`--font-${property}`);
  }
}

// Same-origin reloads avoid a font flash. The shared store restores the server
// choice after mounting, including when the desktop server uses a new port.
export const FONT_INIT_SCRIPT = `(()=>{try{const f=JSON.parse(localStorage.getItem(${JSON.stringify(FONT_STORAGE_KEY)})||"null");const valid=${isFontFamily.toString()};if(f&&valid(f.ui)&&valid(f.mono)&&(f.uiSize===undefined||(Number.isInteger(f.uiSize)&&f.uiSize>=12&&f.uiSize<=18))){(${applyFontPreferences.toString()})(f)}}catch{}})();`;
