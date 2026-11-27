from dzhura_helper_bot.translate.language import LANG_DIR, load, load_source


def test_knows_its_own_code() -> None:
    assert load("uk").code == "uk"


def test_reads_the_source_settings_of_a_language() -> None:
    assert load_source("en").ner_model == "en_core_web_sm"
    assert load_source("en").term_match == "whole"


def test_a_language_without_data_gets_the_generic_settings() -> None:
    assert load_source("ru").ner_model is None
    assert load_source("ru").term_match == "stem"
    assert load_source(None).ner_model is None


def test_the_language_data_folder_exists() -> None:
    assert LANG_DIR.is_dir()
    assert (LANG_DIR / "uk" / "language.json").is_file()
