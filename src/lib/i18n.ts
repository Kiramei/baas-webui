import i18n from "i18next";
import {initReactI18next} from "react-i18next";
import {StorageUtil} from "@/lib/storage.ts";

/**
 * Initialize i18next immediately so React never complains.
 * Resources are empty at first; we load them dynamically later.
 */
i18n.use(initReactI18next).init({
  lng: StorageUtil.get("uiSettings")?.["lang"] || "en",
  fallbackLng: "en",
  resources: {},
  interpolation: {escapeValue: false},
});

/**
 * Load locale JSON file from /public/locales/
 */
export async function loadLocale(lang: string) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`Failed to load locale: ${lang}`);
    const data = await res.json();

    // Add or overwrite translations for this language
    i18n.addResourceBundle(lang, "translation", data, true, true);

    // Change the current language
    await i18n.changeLanguage(lang);

    console.log(`[i18n] switched to ${lang}`);
  } catch (err) {
    console.error(`[i18n] failed to load ${lang}:`, err);
  }
}

export default i18n;
