import type { Language } from "./types";

/** Languages the parser recognises. Names are what the translation miners accept. */
export const LANGUAGES: Array<Language & { aliases: string[] }> = [
  { name: "Hindi", code: "hi", aliases: ["hindi", "हिंदी", "हिन्दी"] },
  { name: "Spanish", code: "es", aliases: ["spanish", "español", "espanol", "castellano"] },
  { name: "French", code: "fr", aliases: ["french", "français", "francais"] },
  { name: "German", code: "de", aliases: ["german", "deutsch"] },
  { name: "Portuguese", code: "pt", aliases: ["portuguese", "português", "portugues"] },
  { name: "Italian", code: "it", aliases: ["italian", "italiano"] },
  { name: "Dutch", code: "nl", aliases: ["dutch", "nederlands"] },
  { name: "Russian", code: "ru", aliases: ["russian", "русский"] },
  { name: "Ukrainian", code: "uk", aliases: ["ukrainian"] },
  { name: "Polish", code: "pl", aliases: ["polish", "polski"] },
  { name: "Turkish", code: "tr", aliases: ["turkish", "türkçe", "turkce"] },
  { name: "Arabic", code: "ar", aliases: ["arabic", "العربية"] },
  { name: "Persian", code: "fa", aliases: ["persian", "farsi"] },
  { name: "Urdu", code: "ur", aliases: ["urdu", "اردو"] },
  { name: "Bengali", code: "bn", aliases: ["bengali", "bangla", "বাংলা"] },
  { name: "Tamil", code: "ta", aliases: ["tamil", "தமிழ்"] },
  { name: "Telugu", code: "te", aliases: ["telugu", "తెలుగు"] },
  { name: "Marathi", code: "mr", aliases: ["marathi", "मराठी"] },
  { name: "Gujarati", code: "gu", aliases: ["gujarati", "ગુજરાતી"] },
  { name: "Kannada", code: "kn", aliases: ["kannada", "ಕನ್ನಡ"] },
  { name: "Malayalam", code: "ml", aliases: ["malayalam", "മലയാളം"] },
  { name: "Punjabi", code: "pa", aliases: ["punjabi", "ਪੰਜਾਬੀ"] },
  { name: "Odia", code: "or", aliases: ["odia", "oriya"] },
  { name: "Nepali", code: "ne", aliases: ["nepali"] },
  { name: "Sinhala", code: "si", aliases: ["sinhala", "sinhalese"] },
  { name: "Chinese", code: "zh", aliases: ["chinese", "mandarin", "中文", "simplified chinese", "traditional chinese"] },
  { name: "Japanese", code: "ja", aliases: ["japanese", "日本語"] },
  { name: "Korean", code: "ko", aliases: ["korean", "한국어"] },
  { name: "Vietnamese", code: "vi", aliases: ["vietnamese", "tiếng việt"] },
  { name: "Thai", code: "th", aliases: ["thai", "ไทย"] },
  { name: "Indonesian", code: "id", aliases: ["indonesian", "bahasa indonesia", "bahasa"] },
  { name: "Malay", code: "ms", aliases: ["malay", "bahasa melayu"] },
  { name: "Filipino", code: "tl", aliases: ["filipino", "tagalog"] },
  { name: "Swahili", code: "sw", aliases: ["swahili", "kiswahili"] },
  { name: "Hebrew", code: "he", aliases: ["hebrew", "עברית"] },
  { name: "Greek", code: "el", aliases: ["greek", "ελληνικά"] },
  { name: "Swedish", code: "sv", aliases: ["swedish", "svenska"] },
  { name: "Norwegian", code: "no", aliases: ["norwegian", "norsk"] },
  { name: "Danish", code: "da", aliases: ["danish", "dansk"] },
  { name: "Finnish", code: "fi", aliases: ["finnish", "suomi"] },
  { name: "Czech", code: "cs", aliases: ["czech", "čeština"] },
  { name: "Hungarian", code: "hu", aliases: ["hungarian", "magyar"] },
  { name: "Romanian", code: "ro", aliases: ["romanian", "română"] },
  { name: "English", code: "en", aliases: ["english"] },
];

export function findLanguage(word: string): Language | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  for (const l of LANGUAGES) {
    if (l.code === w || l.name.toLowerCase() === w || l.aliases.includes(w)) return { name: l.name, code: l.code };
  }
  return null;
}
