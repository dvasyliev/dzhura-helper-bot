# Library group (optional)

The bot can post everything it makes into a Telegram group: a topic per book, one for karaoke and one for YouTube summaries (what it looks like: [README](../README.md#library-group)). Without a group, files come to the private chat. No `.env` value is needed: the bot saves the group by itself.

1. In Telegram, create a group and turn on **Topics** in its settings.
2. Add the bot to the group.
3. Make the bot an admin with **Manage topics**, **Delete messages** and **Pin messages**.
4. The bot replies in the private chat that the group is saved, or which rights it still lacks.
5. Send `/publish` in the private chat: the bot posts everything already in `data/`. Later results go to the group by themselves.

To share the library, invite people to the group. To keep it tidy, turn off **Send messages** for members in the group's **Permissions**: they can still listen and download. The bot follows only your commands and button presses, even in the group.

How the group is kept in sync: [how-it-works.md](how-it-works.md#the-library-group).
