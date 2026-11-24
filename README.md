# Audiobook bot

Особистий Telegram-бот: надсилаєте EPUB українською, він озвучує кожен розділ через Fish Audio і надсилає аудіо по черзі (`001 Назва розділу`, …). Відповідає тільки власнику.

## Налаштування

1. Створіть бота в [@BotFather](https://t.me/BotFather) (`/newbot`) і скопіюйте токен.
2. Дізнайтеся свій Telegram ID в [@userinfobot](https://t.me/userinfobot).
3. Візьміть API-ключ на <https://fish.audio/app/api-keys/>.
4. `cp .env.example .env` і заповніть `BOT_TOKEN`, `OWNER_ID`, `FISH_API_KEY`. `FISH_VOICE_ID` уже містить голос «Український Диктор».
5. `npm install`

## Запуск

```bash
caffeinate -i npm start
```

`caffeinate` не дає Mac заснути, поки бот працює. Зупинка: `Ctrl+C`.

## Модель

`FISH_MODEL=s2.1-pro-free` — безкоштовна. Коли Fish її закриє, поставте `FISH_MODEL=s2.1-pro` ($15 за 1 млн байтів, ≈ $16 за середню книжку) і перезапустіть.

## Ліміти Telegram

- EPUB до 20 МБ (бот більший файл не скачає).
- Аудіо до 50 МБ: довший розділ приходить частинами `001a`, `001b`.
