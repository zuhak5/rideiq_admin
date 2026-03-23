import { errorJson } from "../_shared/json.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};
const DEFAULT_RETURN_URL = "rabi7://auth/captcha";

function resolveReturnUrl(): string {
  return DEFAULT_RETURN_URL;
}

function buildPage(params: {
  state: string;
  siteKey: string;
  returnUrl: string;
  bridge: string;
}) {
  const state = JSON.stringify(params.state);
  const siteKey = JSON.stringify(params.siteKey);
  const returnUrl = JSON.stringify(params.returnUrl);
  const bridge = JSON.stringify(params.bridge);

  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <meta name="robots" content="noindex">
    <title>Rabi7 verification</title>
    <style>
      :root {
        color-scheme: light;
        font-family: system-ui, sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
          radial-gradient(circle at top, #f3faf6 0%, #ffffff 52%),
          linear-gradient(180deg, #ffffff 0%, #f6f6f6 100%);
        color: #14212d;
      }

      #card {
        width: min(92vw, 420px);
        padding: 20px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 42px rgba(0, 0, 0, 0.08);
      }

      h1 {
        margin: 0 0 10px;
        font-size: 20px;
      }

      p {
        margin: 0 0 16px;
        line-height: 1.6;
        color: #5b646e;
      }

      #captcha {
        min-height: 74px;
      }

      #status {
        min-height: 24px;
        margin-top: 16px;
        color: #a14b00;
      }

      #open-app-link {
        display: none;
        margin-top: 16px;
        color: #1f6ed4;
        font-weight: 600;
      }

      #cancel-link {
        display: inline-block;
        margin-top: 16px;
        color: #5b646e;
      }
    </style>
    <script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      async
      defer
    ></script>
    <script>
      const captchaState = ${state};
      const returnUrl = ${returnUrl};
      const siteKey = ${siteKey};
      const bridge = ${bridge};
      let widgetId = null;

      function buildReturnUrl(params) {
        const nextUrl = new URL(returnUrl);
        nextUrl.searchParams.set('state', captchaState);
        Object.entries(params).forEach(([key, value]) => {
          if (typeof value === 'string' && value.trim()) {
            nextUrl.searchParams.set(key, value.trim());
          }
        });
        return nextUrl.toString();
      }

      function setOpenAppLink(url) {
        const anchor = document.getElementById('open-app-link');
        anchor.href = url;
        anchor.style.display = 'inline-block';
      }

      function buildLegacyReturnParams(payload) {
        if (payload.type === 'token' && typeof payload.token === 'string') {
          return { captcha_token: payload.token };
        }

        return {
          error:
            (typeof payload.code === 'string' && payload.code.trim()) ||
            (typeof payload.type === 'string' && payload.type.trim()) ||
            'turnstile_error',
          message:
            (typeof payload.message === 'string' && payload.message.trim()) ||
            'Captcha failed to load.'
        };
      }

      function postBridgePayload(payload) {
        const rawPayload = JSON.stringify(payload);

        if (bridge === 'native') {
          const channel =
            typeof AuthCaptchaBridge !== 'undefined'
              ? AuthCaptchaBridge
              : window.AuthCaptchaBridge;
          if (channel && typeof channel.postMessage === 'function') {
            channel.postMessage(rawPayload);
            return true;
          }
        }

        if (bridge === 'web' && window.parent && window.parent !== window) {
          window.parent.postMessage(rawPayload, '*');
          return true;
        }

        return false;
      }

      function returnToApp(payload) {
        const normalizedPayload = {
          state: captchaState,
          ...payload
        };
        const status = document.getElementById('status');
        if (postBridgePayload(normalizedPayload)) {
          status.textContent =
            normalizedPayload.type === 'token'
              ? 'Returning to the app...'
              : 'Verification finished. Return to the app to continue.';
          return;
        }

        const nextUrl = buildReturnUrl(buildLegacyReturnParams(normalizedPayload));
        status.textContent = 'Returning to the app...';
        setOpenAppLink(nextUrl);
        window.location.replace(nextUrl);
      }

      function setStatus(message) {
        document.getElementById('status').textContent = message;
      }

      function renderCaptcha() {
        if (!window.turnstile) {
          window.setTimeout(renderCaptcha, 120);
          return;
        }

        if (widgetId !== null) {
          try {
            window.turnstile.remove(widgetId);
          } catch (_) {}
          widgetId = null;
        }

        widgetId = window.turnstile.render('#captcha', {
          sitekey: siteKey,
          retry: 'auto',
          'retry-interval': 1000,
          'refresh-expired': 'auto',
          'refresh-timeout': 'auto',
          callback: function(token) {
            returnToApp({
              type: 'token',
              token: token
            });
          },
          'error-callback': function(code) {
            returnToApp({
              type: 'error',
              code: code || 'turnstile_error',
              message: 'Captcha failed to load.'
            });
          },
          'expired-callback': function() {
            returnToApp({
              type: 'expired',
              message: 'Verification expired. Try again.'
            });
          },
          'timeout-callback': function() {
            returnToApp({
              type: 'timeout',
              message: 'Verification timed out before completion. Try again.'
            });
          },
          'unsupported-callback': function() {
            returnToApp({
              type: 'error',
              code: 'unsupported',
              message: 'Captcha verification is unavailable on this device.'
            });
          }
        });
      }

      window.addEventListener('load', function() {
        const cancelLink = document.getElementById('cancel-link');
        cancelLink.href = buildReturnUrl({ error: 'cancelled' });
        setStatus('Complete the verification and you will return to the app automatically.');
        renderCaptcha();
      });
    </script>
  </head>
  <body>
    <div id="card">
      <h1>Verify before you continue</h1>
      <p>Complete this short verification to keep sign-in and OTP requests secure.</p>
      <div id="captcha"></div>
      <p id="status"></p>
      <a id="open-app-link" href="#">Open Rabi7</a>
      <a id="cancel-link" href="#">Cancel and return to the app</a>
    </div>
  </body>
</html>`;
}

export async function handleAuthCaptcha(req: Request): Promise<Response> {
  return await withRequestContext("auth-captcha", req, async (_ctx) => {
    if (req.method !== "GET") {
      return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");
    }

    const url = new URL(req.url);
    const state = url.searchParams.get("state")?.trim() ?? "";
    if (!state) {
      return errorJson("Missing captcha state.", 400, "STATE_REQUIRED");
    }

    const siteKey = url.searchParams.get("site_key")?.trim() ?? "";
    if (!siteKey) {
      return errorJson("Missing Turnstile site key.", 500, "SITE_KEY_MISSING");
    }

    const bridge = url.searchParams.get("bridge")?.trim() || "native";

    return new Response(
      buildPage({
        state,
        siteKey,
        returnUrl: resolveReturnUrl(),
        bridge,
      }),
      {
        status: 200,
        headers: HTML_HEADERS,
      },
    );
  });
}

if (import.meta.main) {
  Deno.serve(handleAuthCaptcha);
}
