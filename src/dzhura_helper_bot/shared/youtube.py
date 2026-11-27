"""yt-dlp options every YouTube call starts from."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from yt_dlp import _Params  # noqa: F401  # pyright: ignore[reportPrivateUsage]  # the stubs' only name for YoutubeDL's options

# yt-dlp writes into the options it gets, so each call passes a copy ({**YOUTUBE_OPTIONS, ...}).
# Node solves YouTube's JS challenges (with the yt-dlp-ejs solver), so no deno is needed: the bot already runs on Node.
YOUTUBE_OPTIONS: "_Params" = {
    "quiet": True,
    "no_warnings": True,
    "socket_timeout": 30,  # seconds a YouTube connection may stall
    "js_runtimes": {"node": {}},
}
