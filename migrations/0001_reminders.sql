-- Напомняния по имейл преди изтичане (винетка / ГТП / ГО) и запитвания от фирми.
-- Времената са ISO 8601 в UTC (new Date().toISOString()); датите са ГГГГ-ММ-ДД
-- по българско време. Нищо от резултата на проверката не се пази освен датата.

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                 -- с малки букви
  plate TEXT NOT NULL,                 -- нормализиран номер, напр. CB1234AB
  kind TEXT NOT NULL CHECK (kind IN ('vignette', 'gtp', 'go')),
  valid_to TEXT NOT NULL,              -- ГГГГ-ММ-ДД: денят, в който изтича
  checked_on TEXT NOT NULL,            -- ГГГГ-ММ-ДД: денят на проверката, от която е датата
  confirmed_at TEXT,                   -- NULL до потвърждение от имейла (double opt-in)
  sent_14_at TEXT,                     -- изпратено напомняне 14 дни преди
  sent_3_at TEXT,                      -- изпратено напомняне 3 дни преди
  sent_1_at TEXT,                      -- изпратено напомняне в деня преди (кратки срокове)
  send_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (email, plate, kind)
);

CREATE INDEX reminders_valid_to ON reminders (valid_to);
CREATE INDEX reminders_email ON reminders (email);

-- Връзките в писмата: пази се само SHA-256 на токена, никога самият токен.
-- confirm: потвърждава заявката; manage: спира напомнянето или трие всичко за имейла.
CREATE TABLE reminder_tokens (
  hash TEXT PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'manage')),
  created_at TEXT NOT NULL
);

CREATE INDEX reminder_tokens_reminder ON reminder_tokens (reminder_id);

-- Запитвания от страницата „За фирми и автопаркове“ (планирана услуга).
CREATE TABLE business_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  company TEXT,
  vehicles TEXT NOT NULL,              -- диапазон: 2-5, 6-20, 21-50, 51-200, 200+
  needs TEXT NOT NULL,                 -- избраните нужди, разделени със запетая
  budget TEXT NOT NULL,                -- диапазон за месечна цена, вкл. "0" = не бих платил
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX business_leads_email ON business_leads (email);

-- Ограничение на честотата и еднократност на ALTCHA решенията. key е HMAC
-- отпечатък (на IP, на имейл или на challenge) — суровите стойности не се пазят.
-- Редовете се трият след 24 часа.
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX attempts_lookup ON attempts (kind, key, created_at);
CREATE INDEX attempts_created_at ON attempts (created_at);

-- Сървърен ключ за подписване на ALTCHA challenge-ите и за отпечатъците по-горе.
-- Създава се сам при първата заявка; не е нужна ръчна настройка.
CREATE TABLE app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
