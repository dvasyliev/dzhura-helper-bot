from dzhura_helper_bot.summary.transcript import choose_subtitles, group_lines, json3_lines, stamp


def test_json3_lines_joins_segments_and_skips_blank_events() -> None:
    data = {
        "events": [
            {"tStartMs": 1000, "segs": [{"utf8": "Hello"}, {"utf8": " world"}]},
            {"tStartMs": 2000, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 3500},
            {"tStartMs": 4000, "segs": [{"utf8": "again"}]},
        ]
    }
    assert json3_lines(data) == [(1.0, "Hello world"), (4.0, "again")]


def test_group_lines_starts_a_new_line_every_30_seconds() -> None:
    lines = [(0.0, "a"), (10.0, "b"), (31.0, "c"), (3700.0, "d")]
    assert group_lines(lines) == ["[0:00] a b", "[0:31] c", "[1:01:40] d"]


def test_stamp() -> None:
    assert stamp(65) == "1:05"
    assert stamp(3725) == "1:02:05"


def test_choose_subtitles_prefers_the_video_language() -> None:
    assert choose_subtitles("en", {"de": [], "en": []}) == "en"
    assert choose_subtitles("uk", {"uk-UA": []}) == "uk-UA"
    assert choose_subtitles("en-US", {"de": [], "en": []}) == "en"
    assert choose_subtitles("en", {"de": []}) == "de"
    assert choose_subtitles(None, {"de": []}) == "de"
    assert choose_subtitles("en", {}) is None
