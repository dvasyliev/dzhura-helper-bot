# YouTube upload for karaoke (optional)

The bot uploads each finished karaoke to your channel as unlisted, adds it to a playlist and sends you the link in Telegram. Without this setup it sends the video itself to Telegram (up to 50 MB). `YOUTUBE_PLAYLIST_ID` is the switch: keep the Google keys in `.env` and leave the playlist empty to get videos in Telegram again.

It's all free. The API quota covers about 100 uploads a day.

**With an agent:** sign in to [console.cloud.google.com](https://console.cloud.google.com) in the browser with the account that owns your YouTube channel, then ask Claude Code to "set up the YouTube upload following docs/youtube-upload.md". Yours to do: the checkbox agreeing to Google's policy (step 3), pasting the values into `.env` (steps 4 and 5), and the first sign-in (step 6).

## 1. Google Cloud project

Sign in with the Google account that owns your YouTube channel.

1. Open [console.cloud.google.com](https://console.cloud.google.com).
2. Top left, pick the project selector → **New project**. Any name, for example `Dzhura`. **Create**.
3. Make sure this project is selected at the top.

## 2. Enable YouTube Data API v3

1. Menu → **APIs & Services** → **Library**.
2. Find **YouTube Data API v3** → **Enable**.

## 3. OAuth consent screen

This is the screen Google shows when you let the bot access your channel.

1. Menu → **APIs & Services** → **OAuth consent screen** (or **Google Auth Platform**) → **Get started**.
2. **App name**: `Dzhura`. **User support email**: your email. **Next**.
3. **Audience**: **External**. **Next**.
4. **Contact information**: your email. **Next**.
5. Tick "I agree to the Google API Services: User Data Policy" → **Continue** → **Create**.
6. **Audience** section → **Test users** → **Add users** → add the email of the account with the YouTube channel → **Save**.

The app stays in **Testing**. Don't publish it. As a result, a sign-in lasts 7 days, then the bot asks you to sign in again (see step 6).

## 4. OAuth client

1. **Clients** section (or **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**).
2. **Application type**: **TVs and Limited Input devices**. It must be this type: it lets you sign in with a code from another device, with no browser on the Mac.
3. Any name, for example `Dzhura bot`. **Create**.
4. Copy the **Client ID** and **Client secret** into `.env`:

```env
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

## 5. Playlist

The bot puts every karaoke into one playlist.

1. Create a playlist on YouTube (unlisted or private is fine).
2. Open it. The playlist ID is in the address after `list=`, for example `PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
3. Put it into `.env`:

```env
YOUTUBE_PLAYLIST_ID=PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Restart the bot (`npm start`).

## 6. First sign-in

Nothing to run. On the first upload the bot sends you in Telegram:

> To upload to YouTube, sign in: open google.com/device, enter the code from the next message and pick the account with the channel.

The next message is the code, like `ABCD-EFGH`.

1. On any device, open [google.com/device](https://www.google.com/device).
2. Enter the code.
3. Pick the account with the channel.
4. Google warns that the app isn't verified. Press **Continue**: it's your own app.
5. Allow access to YouTube.

The code is valid for ~30 minutes; the bot waits and then continues the upload by itself. The sign-in is saved in `data/youtube.json`. Every 7 days the bot will send a new code; that's normal for Testing status.

## About copyright

YouTube checks unlisted videos for other people's music too. A Content ID claim isn't a strike and doesn't hurt the channel: at worst the song's owner blocks the video or mutes it. Don't dispute such claims, and there will be no strike.
