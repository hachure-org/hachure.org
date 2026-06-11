const port = 9223;

async function json(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function ok(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
}

async function createPage() {
  const target = await json(`http://127.0.0.1:${port}/json/new`, { method: "PUT" });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  return { target, ws, send };
}

async function evaluate(url) {
  const page = await createPage();
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Page.navigate", { url });
  await new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Page.loadEventFired") {
        page.ws.removeEventListener("message", onMessage);
        resolve();
      }
    };
    page.ws.addEventListener("message", onMessage);
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = await page.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const q = (sel) => document.querySelector(sel);
      const metric = (sel) => {
        const el = q(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          selector: sel,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      };
      const code = q('.trust-intro code');
      const formula = q('.status-formula code');
      const panel = q('surface-trust-panel');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        gutters: [
          metric('.site-header.site-wrapper'),
          metric('.hero.site-wrapper'),
          metric('.section.site-wrapper'),
          metric('.status-footer.site-wrapper')
        ].filter(Boolean),
        trustIntroCode: code ? {
          text: code.textContent,
          fontFamily: getComputedStyle(code).fontFamily,
          display: getComputedStyle(code).display
        } : null,
        formulaCode: formula ? {
          text: formula.textContent,
          fontFamily: getComputedStyle(formula).fontFamily
        } : null,
        panel: panel ? {
          left: Math.round(panel.getBoundingClientRect().left),
          right: Math.round(panel.getBoundingClientRect().right),
          width: Math.round(panel.getBoundingClientRect().width)
        } : null
      };
    })()`
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  }
  page.ws.close();
  await ok(`http://127.0.0.1:${port}/json/close/${page.target.id}`);
  return result.result?.result?.value;
}

const pages = ["/", "/trust.html"];
const output = {};
for (const path of pages) {
  output[path] = await evaluate(`http://127.0.0.1:8787${path}`);
}
console.log(JSON.stringify(output, null, 2));
