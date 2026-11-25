# Налаштування Dzhura з нуля

Покрокова інструкція: що поставити і що налаштувати, щоб бот запрацював на новому Mac. Потрібен Mac з Apple Silicon (M1 і новіші): озвучка й караоке працюють локально.

Порядок такий:

1. [Загальне](#1-загальне): програми і код.
2. [Telegram-бот](#2-telegram-бот): токен і ваш ID.
3. [Аудіокнига](#3-аудіокнига): Python, моделі наголосів і голосу.
4. [Караоке](#4-караоке): ffmpeg, deno, моделі.
5. [YouTube](#5-youtube-для-караоке): Google Cloud, OAuth, плейлист.
6. [Запуск і перевірка](#6-запуск-і-перевірка).

Місце на диску: близько 6 ГБ на моделі плюс місце під книжки й відео в `data/`.

---

## 1. Загальне

Встановіть [Homebrew](https://brew.sh), якщо його ще немає, потім Node.js і `uv` (менеджер Python):

```bash
brew install node uv
```

Перевірка: `node -v` показує 22 або новішу версію, `uv --version` щось виводить.

Скачайте код і поставте залежності Node:

```bash
git clone <адреса репозиторію> dzhura-helper-bot
cd dzhura-helper-bot
npm install
cp .env.example .env
```

`npm install` заодно вмикає git-хуки з `.githooks/`.

Файл `.env` тримає секрети. Його немає в git, не видаляйте його і нікому не пересилайте.

---

## 2. Telegram-бот

### 2.1. Створити бота

1. У Telegram відкрийте [@BotFather](https://t.me/BotFather).
2. Надішліть `/newbot`.
3. Введіть ім'я, яке бачитимете в чаті, наприклад `Dzhura`.
4. Введіть адресу бота латиницею, вона має закінчуватися на `bot`, наприклад `my_dzhura_helper_bot`.
5. BotFather надішле токен виду `1234567890:AA...`. Скопіюйте його.

Пізніше в @BotFather можна змінити:
- ім'я: `/setname`;
- опис і картинку: `/setdescription`, `/setuserpic`.

Адресу (`@..._bot`) змінити не можна, тільки створити нового бота.

### 2.2. Дізнатися свій Telegram ID

1. Відкрийте [@userinfobot](https://t.me/userinfobot).
2. Надішліть будь-що. Він відповість числом `Id: 123456789`.

Бот відповідає тільки цьому ID, решту ігнорує.

### 2.3. Заповнити `.env`

```env
BOT_TOKEN=1234567890:AA...
OWNER_ID=123456789
```

Без цих двох змінних бот не запуститься.

---

## 3. Аудіокнига

Озвучка йде локально: текст готує Python (цифри словами, наголоси), голос робить модель [HolosTTS](https://huggingface.co/patriotyk/HolosTTS) через MLX.

### 3.1. Python-залежності

```bash
uv sync
```

`uv` сам поставить Python 3.12 і всі бібліотеки в папку `.venv` (близько 1 ГБ). Ця папка є Python-версією `node_modules`. Якщо її видалити, `uv` створить її знову, але доведеться знову качати ~1 ГБ.

Що ставиться для аудіокниги (з [pyproject.toml](pyproject.toml)):
- `holos-tts-mlx`: модель голосу;
- `ipa-uk`: переводить текст у фонеми, ставиться з GitHub;
- `accentuk`: наголоси (словник і нейромережа);
- `num2words`: цифри словами;
- `lameenc`: кодує mp3.

### 3.2. Моделі наголосів

Один раз після `uv sync`:

```bash
uv run accentuk download --light
uv run python src/features/audiobook/scripts/stress_index.py
```

- Перша команда качає модель наголосів (~375 МБ) у `~/.cache/accentuk`.
- Друга качає наголоси з Вікісловника (~320 МБ) і зберігає з них 18 МБ у `~/.cache/audiobook-bot/stress.json`.

### 3.3. Модель голосу

Окремо нічого робити не треба. HolosTTS скачається з Hugging Face при першій озвучці (кілька сотень МБ) у `~/.cache/huggingface/hub`. Тому перша книжка почнеться із затримкою.

### 3.4. Провайдер голосу (необов'язково)

За замовчуванням озвучує локальний HolosTTS. У `.env`:

```env
TTS_PROVIDER=holos
```

Щоб замість нього брати хмарний [Fish Audio](https://fish.audio) (платний, читає з російським акцентом):

```env
TTS_PROVIDER=fish
FISH_API_KEY=ваш_ключ
FISH_MODEL=s2.1-pro-free
```

Ключ береться в кабінеті Fish Audio. `FISH_MODEL` можна не писати, тоді буде `s2.1-pro-free`.

Голоси для кнопок лежать у [voices.json](voices.json).

### 3.5. Перевірка

Покладіть EPUB у `data/audiobook/<Автор> - <Назва>/` і озвучте шматок:

```bash
npm run sample -- "<Автор> - <Назва>" 150
```

У `data/voice-samples/holos/` з'являться mp3 з першими 150 словами кожним голосом.

---

## 4. Караоке

Караоке теж робиться локально: скачати кліп, відділити голос, розпізнати спів, знайти текст, підігнати слова, зібрати відео.

### 4.1. ffmpeg з libass і deno

```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg deno
```

- **ffmpeg** накладає текст на відео. Потрібна саме ця збірка: у звичайному `brew install ffmpeg` немає `libass`, бібліотеки, яка малює субтитри. Якщо звичайний ffmpeg уже стоїть, спершу `brew uninstall ffmpeg`.
- Ця збірка компілюється на вашому Mac, це 10–30 хвилин. Кожен `brew upgrade` теж збиратиме її заново.
- **deno** потрібен `yt-dlp`, щоб розбирати сторінки YouTube. Без нього скачування з YouTube може перестати працювати.

Перевірка, що libass є:

```bash
ffmpeg -hide_banner -filters | grep -w ass
```

Має вивести рядок з `ass`.

### 4.2. Python-залежності

Вони вже стоять після `uv sync` з кроку 3.1:
- `yt-dlp`: скачує кліп;
- `audio-separator`: відділяє голос від музики (модель Mel-Band RoFormer);
- `audioread`: потрібен `audio-separator`, але той його не ставить сам, тому він вписаний окремо;
- `mlx-whisper`: розпізнає мову й текст пісні;
- `ctc-forced-aligner`: підганяє кожне слово під спів. Ставиться з GitHub, бо пакет з такою назвою на PyPI чужий і знає лише англійські літери;
- `pillow`: міряє ширину рядка, щоб текст влазив у кадр.

`yt-dlp` час від часу ламається, коли YouTube щось змінює. Тоді оновіть його:

```bash
uv lock --upgrade-package yt-dlp && uv sync
```

### 4.3. Моделі

Скачаються самі при першому караоке:
- відділення голосу ~900 МБ;
- синхронізація слів ~1,2 ГБ;
- Whisper ~1,5 ГБ.

Перше караоке через це йде довше.

### 4.4. Тексти пісень

Тексти бот бере з [LRCLIB](https://lrclib.net). Ключ не потрібен. Якщо тексту немає, бот запропонує надіслати його самому або зробити з розпізнаного.

Без кроку 5 караоке вже працює: бот надсилає відео прямо в Telegram (до 50 МБ).

---

## 5. YouTube (для караоке)

Бот заливає готове караоке на ваш канал з доступом «за посиланням», кладе в плейлист і надсилає в Telegram посилання. Це необов'язково: без `GOOGLE_CLIENT_ID` і `GOOGLE_CLIENT_SECRET` бот нічого не заливає.

Усе безкоштовно. Ліміт API вистачає приблизно на 100 заливок на день.

### 5.1. Проєкт у Google Cloud

Входьте тим Google-акаунтом, на якому ваш YouTube-канал.

1. Відкрийте [console.cloud.google.com](https://console.cloud.google.com).
2. Угорі зліва виберіть проєкт → **New project**. Назва будь-яка, наприклад `Dzhura`. **Create**.
3. Переконайтеся, що вгорі вибраний саме цей проєкт.

### 5.2. Увімкнути YouTube Data API v3

1. Меню → **APIs & Services** → **Library**.
2. Знайдіть **YouTube Data API v3** → **Enable**.

### 5.3. Екран входу (OAuth consent screen)

Це вікно, яке Google покаже, коли ви дозволятимете боту доступ до каналу.

1. Меню → **APIs & Services** → **OAuth consent screen** (або **Google Auth Platform**) → **Get started**.
2. **App name**: `Dzhura`. **User support email**: ваша пошта. **Next**.
3. **Audience**: **External**. **Next**.
4. **Contact information**: ваша пошта. **Next**.
5. Поставте галочку «I agree to the Google API Services: User Data Policy» → **Continue** → **Create**.
6. Розділ **Audience** → **Test users** → **Add users** → додайте пошту акаунта з YouTube-каналом → **Save**.

Застосунок лишається в статусі **Testing**. Публікувати його не треба. Наслідок: вхід живе 7 днів, потім бот попросить увійти знову (див. 5.6).

### 5.4. OAuth-клієнт

1. Розділ **Clients** (або **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**).
2. **Application type**: **TVs and Limited Input devices**. Саме цей тип: він дозволяє входити кодом з іншого пристрою, без браузера на Mac.
3. Назва будь-яка, наприклад `Dzhura bot`. **Create**.
4. Скопіюйте **Client ID** і **Client secret** у `.env`:

```env
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

### 5.5. Плейлист

Бот кладе всі караоке в один плейлист. Його ID записаний у коді: `PLAYLIST` у [src/features/karaoke/index.ts](src/features/karaoke/index.ts).

Щоб взяти свій:
1. На YouTube створіть плейлист (можна «за посиланням» або приватний).
2. Відкрийте його. ID плейлиста стоїть в адресі після `list=`, наприклад `PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
3. Замініть значення `PLAYLIST` у коді.

### 5.6. Перший вхід

Окремо нічого запускати не треба. При першій заливці бот надішле в Telegram:

> Увійдіть у YouTube: відкрийте google.com/device і введіть код ABCD-EFGH

1. З будь-якого пристрою відкрийте [google.com/device](https://www.google.com/device).
2. Введіть код.
3. Виберіть акаунт з каналом.
4. Google попередить, що застосунок не перевірено. Натисніть **Continue**: це ваш власний застосунок.
5. Дозвольте доступ до YouTube.

Код діє ~30 хвилин, бот чекає і потім сам продовжує заливку. Вхід зберігається в `data/youtube.json`. Раз на 7 днів бот надсилатиме новий код, це нормально для статусу Testing.

### 5.7. Про авторські права

Відео «за посиланням» YouTube теж перевіряє на чужу музику. Позначка Content ID не є порушенням і каналу не шкодить: найгірше, власник пісні заблокує відео або вимкне звук. Не оскаржуйте такі позначки, тоді страйку не буде.

---

## 6. Запуск і перевірка

```bash
caffeinate -i npm start
```

`caffeinate` не дає Mac заснути, поки бот працює. Зупинка: `Ctrl+C`.

Перевірте в Telegram:
1. `/start` показує меню функцій.
2. Аудіокнига: надішліть EPUB українською, бот покаже прогноз і кнопки голосів.
3. Караоке: надішліть посилання на YouTube-кліп, бот запитає, яку версію зробити.
4. YouTube: після караоке бот надішле код входу (перший раз), потім посилання на відео.

### Підсумок `.env`

```env
# Telegram (обов'язково)
BOT_TOKEN=
OWNER_ID=

# Аудіокнига (необов'язково)
TTS_PROVIDER=holos
FISH_API_KEY=
FISH_MODEL=

# YouTube для караоке (необов'язково)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Де що лежить

| Що | Де |
|---|---|
| Книжки, аудіо, караоке | `data/` у проєкті |
| Вхід у YouTube | `data/youtube.json` |
| Python-бібліотеки | `.venv/` у проєкті |
| Модель голосу, Whisper | `~/.cache/huggingface/hub` |
| Модель наголосів | `~/.cache/accentuk` |
| Наголоси з Вікісловника | `~/.cache/audiobook-bot/stress.json` |
