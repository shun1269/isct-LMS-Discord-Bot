# Science Tokyo LMS 課題通知 Bot

Science Tokyo LMS の課題情報だけをログイン済みブラウザから Cloudflare D1 へ同期し、Cloudflare Cron と Discord REST API で期限通知する個人用 Bot です。Discord の `/課題` と `/同期状態` は HTTPS Interactions Endpoint で処理します。LMS の Cookie、`sesskey`、パスワード、SSO 情報は Cloudflare へ送りません。

## アーキテクチャ

```text
Science Tokyo LMS → Tampermonkey → Worker同期API → D1
                                                   ↑
Discord Slash Command → Worker Interactions ──────┤
Cloudflare Cron → Worker → Discord REST API        ┘
```

本番に常駐 Node.js、Express、ローカル SQLite、Discord Gateway、`setInterval()` は使いません。Cron は5分ごとに動作します。

## 方法Bの制約

Worker は LMS にログインしません。新規課題、期限変更、削除・非表示は、LMSをブラウザで開いてTampermonkeyが同期した時点で反映されます。一度同期済みの期限通知はPCを閉じてもCloudflare上で続きます。Moodle APIが50件ちょうど返した場合は不完全同期となり、既存課題を一括無効化しません。

## 必要環境

- Node.js 20以降とnpm
- Cloudflareアカウント
- Discord Application/Botを管理できるDiscord Developer Portalアカウント
- Tampermonkey

以下の主手順はWindowsのコマンドプロンプト（CMD）向けです。

## ローカルセットアップ

```cmd
npm install
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` のプレースホルダーを自分の値へ変更してください。このファイルはGit対象外です。`.env` と混在させないでください。

起動後は次で確認できます。

```cmd
curl http://localhost:8787/health
curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"
```

`curl` がなければブラウザで `http://localhost:8787/health` を開けます。Scheduled URLはWranglerの起動ログに表示されたURLを優先してください。

品質確認:

```cmd
npm run typecheck
npm test
```

## Cloudflareアカウント準備とD1

```cmd
npx wrangler login
npx wrangler d1 create science-tokyo-lms-discord-bot
```

出力された `database_id` で `wrangler.jsonc` の全ゼロUUIDを置き換え、Discordの各IDも同ファイルの `vars` に設定します。

```text
DISCORD_APPLICATION_ID
DISCORD_GUILD_ID
DISCORD_CHANNEL_ID
DISCORD_MENTION
```

`DISCORD_MENTION` はユーザーなら `<@USER_ID>`、ロールなら `<@&ROLE_ID>`、不要なら空文字です。それ以外はメンションとして許可されません。

リモートDBへマイグレーションします。

```cmd
npm run db:migrate:remote
```

## Secrets

十分に長いランダムな同期トークンを用意し、次を対話入力します。値をコマンド行、README、`wrangler.jsonc`、Git管理ファイルへ書かないでください。

```cmd
npx wrangler secret put SYNC_TOKEN
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
```

`DISCORD_PUBLIC_KEY` はBot Tokenではなく、Developer PortalのGeneral InformationにあるPublic Keyです。

## Discord Developer Portal設定

1. ApplicationのBotをDiscordサーバーへ追加し、通知先チャンネルの閲覧・メッセージ送信権限を付与します。
2. General InformationからApplication IDとPublic Key、BotページからBot Tokenを取得します。
3. Guild IDと通知先Channel IDを取得し、`.dev.vars` と `wrangler.jsonc` の該当箇所を設定します。
4. `.dev.vars` を設定してGuildコマンドを登録します。

```cmd
npm run register-commands
```

登録されるコマンドは `/assignments`（日本語 `/課題`、`days`/`日数`: 1～365、既定30）と `/sync-status`（日本語 `/同期状態`）です。応答は本人だけに見えるEphemeralです。

## デプロイとInteractions Endpoint

```cmd
npm run deploy
```

デプロイ後、Discord Developer PortalのGeneral InformationにあるInteractions Endpoint URLへ次を設定します。

```text
https://<worker-domain>/discord/interactions
```

Discordの署名付きPINGが成功すれば保存できます。Gateway方式は併用しません。

## Tampermonkey設定

`userscript/science-tokyo-lms-sync.user.js` をTampermonkeyへコピーし、Tampermonkey上のコピーだけで次を置き換えます。

```js
// @connect      <worker-domain（https://なし）>
const API_BASE = "https://<worker-domain>";
const SYNC_TOKEN = "<Cloudflareに登録したSYNC_TOKEN>";
```

チェックイン済みファイルへ実値を戻さないでください。スクリプトは年度URL `/YYYY/` から `science-tokyo-lms-YYYY` を生成し、手動同期ボタン、6時間ごとの自動同期、コンソール表、成功・失敗表示を維持します。

## 動作確認

1. `https://<worker-domain>/health` が `ok: true` を返すことを確認します。
2. LMSの年度ページを開き、「課題をDiscordへ同期」を押します。
3. Discordで `/同期状態` と `/課題` を実行します。
4. CloudflareのLogsで同期件数とCronの開始・終了を確認します。Secretや署名はログに出ません。

`/health` は最終同期時刻・件数・完全同期フラグだけを返し、課題内容やSecretは返しません。

## 通知仕様

- 7日以内に入った時点で `7d` を1回通知します。
- 24時間を切った後は、`ceil(残り秒 / 3600)` の現在区分（`hourly-24`～`hourly-1`）を各1回通知します。
- 24時間ちょうどは毎時通知ではなく `7d` 側です。
- Cron停止から復旧しても過去区分を一括送信せず、現在区分だけを送ります。
- 通知履歴は期限を主キーに含むため、期限変更後は新しいスケジュールになります。
- 送信前にD1でクレームし、失敗時は解放、異常終了時は15分後に再試行できます。
- D1通知履歴は空から始まるため、初回デプロイ時に24時間以内の課題があれば現在区分が1回通知される可能性があります。

## トラブルシューティング

- 同期が401: TampermonkeyとCloudflare Secretの `SYNC_TOKEN` が一致するか確認します。値はログへ貼らないでください。
- Endpoint URLを保存できない: Public Key、Worker URL、D1マイグレーションを確認します。Discordは全リクエストのEd25519署名検証とPING/PONGを要求します。
- D1エラー: `wrangler.jsonc` の `database_id` と `npm run db:migrate:remote` を確認します。
- コマンドが出ない: Application/Guild IDと `npm run register-commands` の結果を確認します。
- 通知されない: BotのChannel権限、Channel ID、Cron Trigger、同期済み期限を確認します。

## セキュリティ上の注意

- `.dev.vars`、`.env`、Bot Token、SYNC_TOKENをコミットしないでください。
- LMSのCookie、`sesskey`、HTML、SSO情報を送る改変をしないでください。
- Discord通知は `allowed_mentions.parse = []` とし、設定された単一ユーザーまたはロールだけを許可します。
- 同期APIはBearer認証、Interactionsは生本文のEd25519署名検証、SQLはバインド変数を使用します。
- 以前のユーザースクリプトに実トークンを入れたことがある場合、そのトークンは失効させて新しい値を登録してください。
