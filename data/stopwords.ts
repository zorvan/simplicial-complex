// Stopwords for multiple languages to improve word embedding accuracy

export type Language = "en" | "fa" | "es" | "fr" | "de";

export const STOPWORDS_EN = new Set([
	// Articles and determiners
	"the", "a", "an", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
	// Prepositions
	"in", "on", "at", "to", "for", "with", "from", "by", "about", "into", "onto", "of", "off", "over",
	"under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all",
	"each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
	"so", "than", "too", "very", "just", "now", "also", "after", "before", "above", "below", "up",
	"down", "out", "on", "any", "both", "during", "through", "between", "against", "until", "while",
	// Conjunctions
	"and", "or", "but", "if", "because", "as", "until", "while", "although", "though", "unless", "whether",
	"either", "neither", "both", "yet", "so", "since", "than",
	// Pronouns
	"i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself",
	"yourselves", "he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself",
	"they", "them", "their", "theirs", "themselves", "what", "which", "who", "whom", "whose", "whoever",
	"whomever", "whatever", "whichever", "one", "another", "each", "everyone", "everybody", "anyone",
	"anybody", "someone", "somebody", "noone", "nobody", "nothing", "everything", "something", "anything",
	// Auxiliary and common verbs
	"is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does",
	"did", "doing", "get", "gets", "got", "gotten", "make", "makes", "made", "making", "take", "takes",
	"took", "taken", "go", "goes", "went", "gone", "going", "say", "says", "said", "saying", "come",
	"comes", "came", "coming", "see", "sees", "saw", "seen", "know", "knows", "knew", "known", "think",
	"thinks", "thought", "look", "looks", "looked", "looking", "want", "wants", "wanted", "use", "uses",
	"used", "using", "find", "finds", "found", "finding", "give", "gives", "gave", "given", "giving",
	"tell", "tells", "told", "telling", "ask", "asks", "asked", "asking", "work", "works", "worked",
	"working", "seem", "seems", "seemed", "seeming", "feel", "feels", "felt", "feeling", "try", "tries",
	"tried", "trying", "leave", "leaves", "left", "leaving", "call", "calls", "called", "calling",
	// Obsidian-specific
	"note", "notes", "todo", "idea", "link", "tags", "file", "folder", "vault"
]);

// Persian (Farsi) stopwords - Priority second language
export const STOPWORDS_FA = new Set([
	// Articles and determiners
	"این", "آن", "آنان", "اینان", "همین", "همان", "هیچ", "همه", "هیچکس", "همه", "هر", "بعضی", "چند",
	"چنین", "چنان", "ان", "ای", "این", "آن",
	// Prepositions
	"در", "به", "از", "با", "بر", "برای", "تا", "چون", "مثل", "مانند", "راجع", "نسبت", "طرف",
	"وسط", "پشت", "روی", "کنار", "نزد", "دنبال", "بالا", "پایین", "داخل", "خارج", "زیر", "بیرون",
	"اثر", "موجب", "دلیل", "سبب", "جانب", "طرف", "وقت", "حین", "عهد", "مدت", "لحظه", "ساعت",
	"دقیقه", "ثانیه", "روز", "شب", "صبح", "ظهر", "عصر", "بامداد", "شام", "پیش", "بعد", "قبل",
	"نزدیک", "دور", "نزدیکی", "دوری", "اول", "آخر", "میان", "بین",
	// Conjunctions
	"و", "یا", "اما", "ولی", "چون", "چراکه", "زیرا", "بلکه", "نه", "هم", "نیز", "یعنی", "که",
	"چونکه", "اگر", "تا", "چه", "آنکه", "ولیکن", "لیکن", "هنوز", "حال", "وقتی", "بین",
	// Pronouns
	"من", "تو", "او", "ما", "شما", "ایشان", "آنها", "مرا", "ترا", "شما را", "ما را", "آنها را",
	"ام", "ای", "است", "ایم", "اید", "اند", "بودم", "بودی", "بود", "بودیم", "بودید", "بودند",
	"خود", "خودم", "خودت", "خودش", "خودمان", "خودتان", "خودشان",
	// Verbs and auxiliaries (most common forms)
	"کرد", "کردم", "کردی", "کرد", "کردیم", "کردید", "کردند", "کن", "کنم", "کنی", "کند", "کنیم",
	"کنید", "کنند", "شد", "شدم", "شدی", "شد", "شدیم", "شدید", "شدند", "شو", "شوم", "شوی", "شود",
	"شویم", "شوید", "شوند", "بود", "بودم", "بودی", "بود", "بودیم", "بودید", "بودند", "باش",
	"باشم", "باشی", "باشد", "باشیم", "باشید", "باشند", "داد", "دادم", "دادی", "داد", "دادیم",
	"دادید", "دادند", "ده", "دهم", "دهی", "دهد", "دهیم", "دهید", "دهند", "گرفت", "گرفتم",
	"گرفتی", "گرفت", "گرفتیم", "گرفتید", "گرفتند", "گیر", "گیرم", "گیری", "گیرد", "گیریم",
	"گیرید", "گیرند", "زد", "زدم", "زدی", "زد", "زدیم", "زدید", "زدند", "زن", "زنم", "زنی",
	"زند", "زنیم", "زنید", "زنند", "رفت", "رفتم", "رفتی", "رفت", "رفتیم", "رفتید", "رفتند",
	"رو", "روم", "روی", "رود", "رویم", "روید", "روند", "آمد", "آمدم", "آمدی", "آمد", "آمدیم",
	"آمدید", "آمدند", "بیا", "بیایم", "بیایی", "بیاید", "بیاییم", "بیایید", "بیایند",
	// Common particles and modifiers
	"می", "نمی", "نه", "بله", "خوب", "بد", "بسیار", "خیلی", "زیاد", "کم", "کمی", "تنها", "فقط",
	"حتی", "دیگر", "دیگری", "دیگران", "حالا", "الان", "امروز", "دیروز", "فردا", "صبح", "ظهر",
	"عصر", "شب", "گاه", "گاهی", "همیشه", "هرگز", "یک", "دو", "سه", "چهار", "پنج", "اول", "دوام",
	"سوم", "چهارم", "پنجم", "یکی", "چیزی", "کسی", "جایی", "باید", "شاید", "لطفا", "متشکرم",
	"سپاس", "مرسی", "بفرمایید", "برو", "بیا",
	// Common suffixes that appear as standalone in tokenization
	"ها", "های", "ات", "یت", "اش", "مان", "تان", "شان", "ی", "ای", "ایم", "اید", "اند", "م",
	"ی", "ست", "ایم", "اید", "ند", "رم", "ری", "رد", "ریم", "رید", "رند",
	// Obsidian-specific (transliterated)
	"note", "notes", "todo", "idea", "link", "tags", "file", "folder", "vault"
]);

// Spanish stopwords
export const STOPWORDS_ES = new Set([
	"el", "la", "de", "que", "y", "a", "en", "un", "ser", "se", "no", "haber", "por", "con", "su",
	"para", "como", "estar", "tener", "le", "lo", "todo", "pero", "más", "hacer", "o", "poder",
	"decir", "este", "ir", "otro", "ese", "la", "si", "me", "ya", "ver", "porque", "dar", "cuando",
	"él", "muy", "sin", "vez", "mucho", "saber", "qué", "sobre", "mi", "alguno", "mismo", "yo",
	"también", "hasta", "año", "dos", "querer", "entre", "así", "primero", "desde", "grande",
	"esto", "ni", "nos", "llegar", "pasar", "tiempo", "ella", "sí", "día", "uno", "bien", "poco",
	"deber", "entonces", "poner", "cosa", "tanto", "hombre", "parecer", "nuestro", "tan", "donde",
	"ahora", "parte", "después", "vida", "quedar", "siempre", "creer", "hablar", "llevar", "dejar",
	"nada", "cada", "seguir", "menos", "nuevo", "encontrar", "algo", "casa", "gente", "momento",
	"note", "notes", "todo", "idea", "link", "tags", "file", "folder", "vault"
]);

// French stopwords
export const STOPWORDS_FR = new Set([
	"le", "de", "un", "être", "et", "à", "il", "avoir", "ne", "je", "son", "que", "se", "qui",
	"ce", "dans", "en", "du", "elle", "au", "de", "ce", "pour", "pas", "que", "vous", "par",
	"sur", "faire", "plus", "dire", "me", "on", "mon", "lui", "nous", "comme", "mais", "pouvoir",
	"tout", "y", "aller", "voir", "bien", "où", "sans", "tu", "ou", "leur", "là", "deux",
	"mari", "vouloir", "venir", "quand", "grand", "celui", "si", "notre", "même", "ont", "où",
	"tout", "savoir", "votre", "doit", "bon", "très", "aucun", "peu", "même", "trop", "assez",
	"quelque", "fois", "tant", "rien", "toujours", "encore", "quel", "ainsi", "moins", "aussi",
	"note", "notes", "todo", "idée", "lien", "tags", "fichier", "dossier", "coffre"
]);

// German stopwords
export const STOPWORDS_DE = new Set([
	"der", "die", "und", "in", "den", "von", "zu", "mit", "ist", "das", "für", "auf", "sich",
	"dem", "er", "nicht", "ein", "eine", "als", "auch", "es", "an", "werden", "aus", "er",
	"hat", "dass", "sie", "nach", "wird", "bei", "einer", "um", "am", "sind", "noch", "wie",
	"einen", "so", "zum", "sein", "oder", "wurde", "ihr", "bis", "mehr", "durch", "man", "mein",
	"mich", "hatte", "sein", "kann", "sei", "war", "wenn", "würde", "seine", "um", "haben",
	"keine", "vom", "wo", "geht", "können", "ja", "sein", "sehr", "hier", "ganz", "also",
	"dann", "schon", "wohl", "immer", "müssen", "ohne", "etwas", "sagen", "jedoch", "da",
	"note", "notes", "todo", "idee", "link", "tags", "datei", "ordner", "tresor"
]);

// Map of stopwords by language code
export const STOPWORDS_BY_LANG: Record<Language, Set<string>> = {
	en: STOPWORDS_EN,
	fa: STOPWORDS_FA,
	es: STOPWORDS_ES,
	fr: STOPWORDS_FR,
	de: STOPWORDS_DE,
};

// Default language
export const DEFAULT_LANGUAGE: Language = "en";

/**
 * Get stopwords for a specific language
 * Falls back to English if language not found
 */
export function getStopwords(lang: string): Set<string> {
	const normalizedLang = lang.toLowerCase().split("-")[0] as Language;
	return STOPWORDS_BY_LANG[normalizedLang] ?? STOPWORDS_EN;
}

/**
 * Check if a token is a stopword for the given language
 */
export function isStopword(token: string, lang: string = "en"): boolean {
	return getStopwords(lang).has(token.toLowerCase());
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): Language[] {
	return Object.keys(STOPWORDS_BY_LANG) as Language[];
}
