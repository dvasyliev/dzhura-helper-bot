# Audiobook bot

Особистий Telegram-бот-помічник з кількома функціями (аудіокнига, переклад, караоке, summary з YouTube). Відповідає тільки власнику. Потрібен Mac з Apple Silicon.

Аудіокнига: надсилаєте EPUB українською, обираєте голос, і бот озвучує кожен розділ локально моделлю [HolosTTS](https://huggingface.co/patriotyk/HolosTTS) та надсилає аудіо по черзі (`001 Назва розділу`, …).

## Налаштування

1. Створіть бота в [@BotFather](https://t.me/BotFather) (`/newbot`) і скопіюйте токен.
2. Дізнайтеся свій Telegram ID в [@userinfobot](https://t.me/userinfobot).
3. `cp .env.example .env` і заповніть `BOT_TOKEN`, `OWNER_ID`.
4. `npm install`
5. `brew install uv && uv sync` — Python-частина озвучки ([scripts/audiobook/voice.py](scripts/audiobook/voice.py)). Модель (~кілька сотень МБ) скачається при першому запуску.

## Запуск

```bash
caffeinate -i npm start
```

`caffeinate` не дає Mac заснути, поки бот працює. Зупинка: `Ctrl+C`.

## Будова

`/start` показує меню функцій. Кожна функція — окрема папка в [src/features/](src/features/) зі своїми обробниками повідомлень і кнопок; список і порядок у меню — [src/features/index.ts](src/features/index.ts). Функція без обробників показується як «(скоро)». Важкі задачі (озвучка тощо) йдуть по одній через [src/jobs.ts](src/jobs.ts). Python-частини лежать у `scripts/<функція>/`.

| Функція | Стан |
|---|---|
| 🎧 Створити аудіокнигу | працює |
| 🌐 Переклад книжки | скоро |
| 🎤 Згенерувати караоке | скоро |
| 📝 Summary з YouTube | скоро |

## Як озвучується аудіокнига

HolosTTS (`TTS_PROVIDER=holos`), для кожного речення: цифри → слова ([scripts/audiobook/numbers_uk.py](scripts/audiobook/numbers_uk.py)), наголоси (ukrainian-word-stress), фонеми (ipa-uk), голос HolosTTS. Книжка на ~10 годин аудіо озвучується приблизно за 15–20 хвилин. Книжка (EPUB) і її аудіо зберігаються в `data/audiobook/<назва книжки>/`.

Голоси лежать у [voices.json](voices.json), згруповані за провайдером (`holos`, `fish`): `male`, `female` (порядок дає номер кнопки «Чоловічий 1», «Жіночий 2» тощо) і `default` — голоси, що показуються першим рядком із ⭐. Провайдер обирається в `.env`: `TTS_PROVIDER=holos`. `TTS_PROVIDER=fish` — хмарний Fish Audio (потрібен `FISH_API_KEY`; модель `FISH_MODEL`, за замовчуванням `s2.1-pro-free`): він читає з російським акцентом, тому для нього наголошена голосна пишеться великою, а `и`/`е` замінюються на `ы`/`э` ([scripts/audiobook/fish.py](scripts/audiobook/fish.py)).

## Семпл

`npm run sample -- "Діти капітана Гранта" 150` бере EPUB з папки `data/audiobook/Діти капітана Гранта/` і озвучує перші 150 слів кожним голосом поточного `TTS_PROVIDER` у `data/voice-samples/<провайдер>/<голос>.mp3`. У `data/voice-samples/<провайдер>/all/` лежать проби всіх голосів, з яких обирали.

Тести Python-частини: `cd scripts/audiobook && uv run python test_numbers.py && uv run python test_text.py`.

## Ліміти Telegram

- EPUB до 20 МБ (бот більший файл не скачає).
- Аудіо до 50 МБ: розділ довший за 90 хвилин приходить частинами `001a`, `001b`.
