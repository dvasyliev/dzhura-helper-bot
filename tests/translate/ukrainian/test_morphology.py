from dzhura_helper_bot.translate.ukrainian.morphology import forms


def test_gives_the_forms_of_a_dictionary_form_in_the_languages_dictionary() -> None:
    assert "приймав" in forms("приймати", "uk")
    assert forms("приймав", "uk") == {"приймав"}
