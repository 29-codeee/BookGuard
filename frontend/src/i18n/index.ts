import en from './en.json';
import hi from './hi.json';
import kn from './kn.json';

export type Language = 'en' | 'hi' | 'kn';

const dictionaries: Record<Language, Record<string, string>> = {
  en,
  hi,
  kn
};

export function translate(key: string, lang: Language = 'en', params?: Record<string, string | number>): string {
  let text = key;

  // Fallback resolution chain: requested lang -> hi -> en -> key
  if (dictionaries[lang]?.[key]) {
    text = dictionaries[lang][key];
  } else if (dictionaries['hi']?.[key]) {
    text = dictionaries['hi'][key];
  } else if (dictionaries['en']?.[key]) {
    text = dictionaries['en'][key];
  }

  // Replace {param} placeholders if provided
  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue));
    }
  }

  return text;
}
