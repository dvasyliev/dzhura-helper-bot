import { describe, expect, it } from "vitest";
import { speechText } from "./speech.ts";

describe("speechText", () => {
  it("reads the title and level, then the text without its markdown", () => {
    expect(
      speechText(
        "# T\n\n## Стисло\n\nC · https://youtu.be/x\n\n### Тема\n\n- Перше **слово** [1:02](https://youtu.be/x?t=62).\n- Друге `код`\n",
      ),
    ).toBe("T.\n\nСтисло.\n\nТема.\n\nПерше слово.\nДруге код.");
  });

  it("leaves out the contents, which repeats the headings", () => {
    expect(
      speechText(
        "# T\n\n### Зміст\n\n- [0:00](https://youtu.be/x?t=0) Вступ\n- [1:44](https://youtu.be/x?t=104) Далі\n\n### Вступ\n\nТекст [посилання](https://a.b) тут.",
      ),
    ).toBe("T.\n\nВступ.\n\nТекст посилання тут.");
    expect(
      speechText(
        "# T\n\n### Contents\n\n- [0:00](x) Intro\n\n### Intro\n\nText.",
      ),
    ).toBe("T.\n\nIntro.\n\nText.");
  });
});
