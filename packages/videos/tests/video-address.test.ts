import { describe, expect, it } from "vitest";
import { embedUrl, isVideoAddress, parseVideoUrl, watchUrl } from "../src/index";

const youtube = (code: string) => ({ provider: "youtube", code });
const kinescope = (code: string) => ({ provider: "kinescope", code });

describe("parseVideoUrl: площадка и код видео из ссылки", () => {
  it.each([
    ["https://www.youtube.com/watch?v=aircAruvnKk", youtube("aircAruvnKk")],
    ["https://youtube.com/watch?v=aircAruvnKk&t=30s&list=PLx", youtube("aircAruvnKk")],
    ["https://m.youtube.com/watch?v=aircAruvnKk", youtube("aircAruvnKk")],
    ["https://youtu.be/aircAruvnKk?si=abc", youtube("aircAruvnKk")],
    ["https://www.youtube.com/embed/aircAruvnKk", youtube("aircAruvnKk")],
    ["https://www.youtube-nocookie.com/embed/aircAruvnKk?start=10", youtube("aircAruvnKk")],
    ["https://www.youtube.com/shorts/IlU-zDU6aGo", youtube("IlU-zDU6aGo")],
    ["https://www.youtube.com/live/IlU-zDU6aGo", youtube("IlU-zDU6aGo")],
    ["http://www.youtube.com/watch?v=aircAruvnKk", youtube("aircAruvnKk")],
    ["https://kinescope.io/jDrTu7YmHbeRpt6GHfjqGi", kinescope("jDrTu7YmHbeRpt6GHfjqGi")],
    ["https://kinescope.io/embed/gPhDX2pPFyCG77vboYnRCZ", kinescope("gPhDX2pPFyCG77vboYnRCZ")],
    ["https://kinescope.io/embed/gPhDX2pPFyCG77vboYnRCZ?t=5", kinescope("gPhDX2pPFyCG77vboYnRCZ")],
  ])("%s", (url, address) => {
    expect(parseVideoUrl(url)).toEqual(address);
  });

  it.each([
    "https://vimeo.com/123456",
    "https://youtube.com.evil.example/watch?v=aircAruvnKk",
    "https://evil.example/kinescope.io/jDrTu7YmHbeRpt6GHfjqGi",
    "javascript:alert(1)",
    "ftp://youtube.com/watch?v=aircAruvnKk",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=aircAruvnKk%22",
    "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
    "https://kinescope.io/",
    "https://kinescope.io/embed/",
    "https://kinescope.io/a/b/c",
    "https://kinescope.io/bad%20code",
    "https://kinescope.io/pricing",
    "https://kinescope.io/login",
    "https://kinescope.io/Signup",
    "https://www.kinescope.io/blog",
    "https://kinescope.io/embed/dashboard",
    "не ссылка",
  ])("чужое или негодное — undefined: %s", (url) => {
    expect(parseVideoUrl(url)).toBeUndefined();
  });
});

describe("адрес плеера и страницы собирается из площадки и кода", () => {
  it("YouTube — с youtube-nocookie, автозапуском и стартом", () => {
    expect(embedUrl(youtube("aircAruvnKk") as never)).toBe(
      "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0",
    );
    expect(embedUrl(youtube("aircAruvnKk") as never, 200)).toBe(
      "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0&start=200",
    );
    expect(watchUrl(youtube("aircAruvnKk") as never, 200)).toBe("https://www.youtube.com/watch?v=aircAruvnKk&t=200s");
    expect(watchUrl(youtube("aircAruvnKk") as never)).toBe("https://www.youtube.com/watch?v=aircAruvnKk");
  });

  it("Kinescope — со стартом t", () => {
    expect(embedUrl(kinescope("jDrTu7YmHbeRpt6GHfjqGi") as never, 200)).toBe(
      "https://kinescope.io/embed/jDrTu7YmHbeRpt6GHfjqGi?autoplay=1&playsinline=1&t=200",
    );
    expect(embedUrl(kinescope("jDrTu7YmHbeRpt6GHfjqGi") as never)).toBe(
      "https://kinescope.io/embed/jDrTu7YmHbeRpt6GHfjqGi?autoplay=1&playsinline=1",
    );
    expect(watchUrl(kinescope("jDrTu7YmHbeRpt6GHfjqGi") as never, 200)).toBe("https://kinescope.io/jDrTu7YmHbeRpt6GHfjqGi?t=200");
  });

  it("isVideoAddress пропускает только известную площадку и код из допустимых знаков", () => {
    expect(isVideoAddress(youtube("aircAruvnKk"))).toBe(true);
    expect(isVideoAddress(kinescope("jDrTu7YmHbeRpt6GHfjqGi"))).toBe(true);
    expect(isVideoAddress(youtube("aircAruvnK\""))).toBe(false);
    expect(isVideoAddress(kinescope("../../evil"))).toBe(false);
    expect(isVideoAddress(kinescope("pricing"))).toBe(false);
    expect(isVideoAddress({ provider: "vimeo", code: "123456" })).toBe(false);
    expect(isVideoAddress({ provider: "youtube" })).toBe(false);
    expect(isVideoAddress(null)).toBe(false);
  });
});
