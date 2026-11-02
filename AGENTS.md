# Science Tokyo LMS Discord Bot — Ubuntu運用

ユーザーの依頼で、Cloudflare Workers/D1版から自前Ubuntuサーバーへ移行する。
以前のCloudflare向けの実装指示は、現在の構成に合わせてこの文書で置き換える。

- Node.js 24、TypeScript、SQLite (`node:sqlite`) を使用する。
- 同期APIとDiscord Gatewayは `src/index.ts`。期限通知は別プロセス `scripts/run-reminders.ts` とsystemdタイマーで5分ごとに実行する。
- 既定は `DISCORD_MODE=gateway`。Tailscale内のAPIへ接続するため独自ドメインは不要。
- HTTP Interactions方式は互換用。`DISCORD_MODE=http` でのみ有効にし、署名検証を維持する。
- `src/format.ts` の緊急度表示、`src/reminders.ts` の通知区分を意図せず変更しない。
- 24時間未満は毎時区分、2日未満は2d、3日未満は3d、3日以上7日以内は7d。
- complete=trueの非アクティブ化、UPSERT、同期履歴保存はSQLiteの一つのトランザクションで行う。
- 通知キーはsource、event_id、deadline_unix、reminder_type。履歴を維持して移行する。
- Secretを表示・ログ出力・コミットしない。.env、.dev.vars、data/は非追跡。
- 元のローカルSecretファイルを勝手に上書きしない。`env:migrate` は新しいファイルだけ作成する。
- LMSのCookie、sesskey、大学アカウントの認証情報をサーバーへ送らない。
- CloudflareとUbuntuの通知を同時に有効にしない。切り替え順はREADMEに従う。
- APIはloopbackまたは明示的なTailscale IPへバインドする。
- SQLにはバインド変数を使用し、通知のallowed_mentionsを制限する。
- 実装後は `npm install`、`npm run typecheck`、`npm test`、`npm run build` とローカル起動を確認する。
- git statusでユーザーの未コミット変更を確認し、秘密値と生成物を追跡しない。
- `wrangler.jsonc` は既存D1のエクスポート用。Node向けソースをWorkerとしてdeployしない。
- Ubuntuの手順はbash、Windowsのローカル開発はCMDでも再現できる形で説明する。
