# Science Tokyo LMS 課題通知 Bot

Science Tokyo LMS の課題情報をTampermonkeyからCloudflare D1へ同期し、Discordで課題一覧の表示と期限通知を行う個人用Botです。LMSのCookie、`sesskey`、パスワード、SSO情報はCloudflareへ送りません。

## 主な機能

- `/課題`：今後の課題を期限順に表示
- `/同期状態`：Tampermonkeyからの最終同期を表示
- 期限通知：7日以内に1回、24時間未満は1時間区分ごとに1回
- Cloudflare Workers、D1、Cron、Discord HTTP Interactionsで常時稼働

WorkerはLMSへログインしません。新規課題や期限変更は、ログイン済みブラウザでTampermonkeyが同期した時点で反映されます。

## ローカル確認

Windowsのコマンドプロンプトで実行します。

```cmd
npm install
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` のプレースホルダーは自分の値へ変更し、Gitへ追加しないでください。起動後は `http://localhost:8787/health` をブラウザまたは `curl` で確認できます。

```cmd
npm run typecheck
npm test
```

## デプロイの流れ

```cmd
npx wrangler login
npx wrangler d1 create science-tokyo-lms-discord-bot
npm run db:migrate:remote
npx wrangler secret put SYNC_TOKEN
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy
npm run register-commands
```

D1作成後に `wrangler.jsonc` の `database_id` とDiscordの各IDを設定します。デプロイ後はDiscord Developer PortalのInteractions Endpoint URLへ `https://<worker-domain>/discord/interactions` を設定し、Tampermonkey上のスクリプトで `@connect`、`API_BASE`、`SYNC_TOKEN` を置き換えます。

詳しいセットアップ、API、通知、データベース、セキュリティ仕様は [doc.md](doc.md) を参照してください。
