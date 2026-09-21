/**
 * One-time Google authorisation.
 *
 * Getting a refresh token is the only part of the Gmail/Calendar setup that
 * needs a browser, and doing it by hand means pasting URLs and codes around.
 * This runs the loopback flow locally: it prints a link, catches the redirect,
 * exchanges the code, and prints the three lines to put in .env.local.
 *
 * Run: node scripts/google-auth.mjs
 */

import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

const rl = createInterface({ input: stdin, output: stdout });

console.log(`
F.R.I.D.A.Y. — Google 連携のセットアップ

事前に console.cloud.google.com で以下を済ませてください:
  1. プロジェクトを作成し、Gmail API と Google Calendar API を有効化
  2. OAuth 同意画面を設定し、自分のアカウントをテストユーザーに追加
  3. 認証情報 → OAuth クライアントID → アプリの種類「デスクトップアプリ」
     （承認済みリダイレクトURIに ${REDIRECT} を追加できる「ウェブアプリケーション」でも可）
`);

const clientId = (await rl.question("GOOGLE_CLIENT_ID: ")).trim();
const clientSecret = (await rl.question("GOOGLE_CLIENT_SECRET: ")).trim();
rl.close();

if (!clientId || !clientSecret) {
  console.error("\nクライアントIDとシークレットの両方が必要です。");
  process.exit(1);
}

const state = Math.random().toString(36).slice(2);
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES.join(" "),
    // Without both of these Google returns an access token only, and the
    // refresh token — the whole point of this script — never arrives.
    access_type: "offline",
    prompt: "consent",
    state,
  });

console.log(`\nブラウザで次のURLを開き、許可してください:\n\n${authUrl}\n`);
console.log(`待機中… (${REDIRECT})`);

const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", REDIRECT);
    const received = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:3rem">
       <h1 style="font-size:1.1rem">${received ? "認証が完了しました" : "認証に失敗しました"}</h1>
       <p>${received ? "ターミナルに戻ってください。" : error ?? "unknown error"}</p></body>`,
    );

    server.close();
    if (error) reject(new Error(error));
    else if (url.searchParams.get("state") !== state) reject(new Error("state mismatch"));
    else if (received) resolve(received);
  });

  server.listen(PORT);
  server.on("error", reject);
  setTimeout(() => {
    server.close();
    reject(new Error("timed out after 5 minutes"));
  }, 300_000).unref();
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  }),
});

const payload = await response.json();

if (!response.ok || !payload.refresh_token) {
  console.error(
    `\nトークンの取得に失敗しました: ${payload.error_description ?? payload.error ?? response.status}`,
  );
  if (response.ok) {
    console.error(
      "refresh_token が返りませんでした。既に許可済みのアプリの場合に起こります。\n" +
        "myaccount.google.com/permissions でこのアプリのアクセスを削除してから再実行してください。",
    );
  }
  process.exit(1);
}

console.log(`
完了しました。次の3行を .env.local に貼り付けてください:

GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
GOOGLE_REFRESH_TOKEN=${payload.refresh_token}

その後 npm run dev を再起動すると、Settings の Integrations が Connected になります。
`);
