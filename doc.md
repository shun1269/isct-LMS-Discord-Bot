# Science Tokyo LMS 課題通知 Bot 詳細仕様

この文書は実装・運用の詳細をまとめたものです。最短の導入手順は [README.md](README.md) を参照してください。

## 1. アーキテクチャと制約

```text
Science Tokyo LMS
  ↓ Moodle core/ajax（ログイン済みブラウザ）
Tampermonkey
  ↓ Bearer認証付きHTTPS POST
Cloudflare Worker
  ├─ D1（課題、同期履歴、通知履歴）
  ├─ Discord HTTP Interactions
  └─ Cron Trigger → Discord REST API
```

本番ではExpress、ローカルSQLite、Discord Gateway、`setInterval()`、常駐Node.jsサーバーを使用しません。WorkerはLMSへ自動アクセスしないため、新規課題、期限変更、削除・非表示はTampermonkeyが同期した時点で反映されます。一度同期された課題の通知はPCを閉じてもCloudflare上で継続します。

LMSからCloudflareへ送るのは課題名、科目名、期限、リンク、イベントIDなどに限ります。Cookie、`sesskey`、大学アカウントのパスワード、SSO情報、ページHTML全体は送信しません。

## 2. HTTP API

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/health` | 稼働状態と最新同期の概要 |
| `POST` | `/api/v1/assignments/sync` | Tampermonkeyからの課題同期 |
| `POST` | `/discord/interactions` | Discordスラッシュコマンド |

未知のルートは `404` を返します。`/health` は現在時刻、最新同期のsource・時刻・件数・完全同期フラグだけを返し、課題内容やSecretは公開しません。

### 2.1 課題同期

`POST /api/v1/assignments/sync` は `Authorization: Bearer <SYNC_TOKEN>` と `Content-Type: application/json` を必須とします。認証失敗は `401`、不正なContent-Typeは `415`、256 KiB超過は `413`、入力不正は `400` です。認証値はログへ出力しません。

```ts
interface SyncPayload {
  source: string;
  complete: boolean;
  assignments: AssignmentInput[];
}

interface AssignmentInput {
  source: string;
  eventId: number;
  courseModuleId: number | null;
  course: string;
  courseJa: string;
  title: string;
  deadlineUnix: number;
  deadlineIso: string;
  deadlineJst: string | null;
  module: string;
  url: string;
  overdue: boolean;
  syncedAt: string;
}
```

主な検証規則は次のとおりです。

- `source` は `science-tokyo-lms-YYYY` 形式の1～100文字
- 各課題の `source` はトップレベルと一致
- `eventId` は0以上の整数、`courseModuleId` は0以上の整数または `null`
- 科目名と課題名は空文字不可
- `deadlineUnix` は正の整数で、`deadlineIso` と1秒を超えて矛盾しないこと
- `url` は `https://lms.s.isct.ac.jp/` のURL
- 課題は最大500件
- `deadlineJst` と `syncedAt` は互換性のため受理するが、期限計算には使用しない

成功時は次の形式で返します。

```json
{ "ok": true, "received": 8, "active": 8 }
```

`complete: true` の場合、そのsourceの既存課題を一旦非アクティブ化してから受信課題をUPSERTします。`complete: false` の場合、既存課題は一括無効化せず受信課題だけをUPSERTします。TampermonkeyはMoodle APIから50件ちょうど取得した場合、取りこぼしを考慮して `complete: false` を送ります。同期処理と同期履歴の記録はD1の `batch()` でまとめて実行します。

## 3. Discord Interactions

Discordからの全リクエストは、JSON解析前の生本文、`x-signature-ed25519`、`x-signature-timestamp`、Developer PortalのPublic Keyを使って検証します。必須ヘッダー欠落または署名不正は `401` です。Interaction Type 1にはPONGを返し、Type 2のコマンドを処理します。

### `/assignments`（日本語 `/課題`）

`days`（日本語 `日数`）は1～365、既定30です。現在から指定日数以内のアクティブな課題を期限順で最大50件表示します。科目名、課題名、絶対期限、相対期限、リンクを含み、約3800文字で省略します。応答はEphemeralです。

### `/sync-status`（日本語 `/同期状態`）

最新の同期日時、受信件数、完全同期フラグ、sourceをEphemeralで表示します。履歴がなければ「まだLMSから同期されていません。」と返します。

### コマンド登録

GuildコマンドとしてDiscord REST APIへ登録します。`.dev.vars` にBot Token、Application ID、Guild IDを設定して実行します。

```cmd
npm run register-commands
```

## 4. 期限通知

Cron Triggerは `*/5 * * * *` で5分ごとに実行されます。期限までの秒数だけを基準に、1回のCron実行につき1課題へ現在の通知種別を1つだけ選びます。

- `remainingSeconds <= 0`：通知しない
- `0 < remainingSeconds < 24 * 3600`：`hourly-${ceil(remainingSeconds / 3600)}`
- 24時間以上2日未満：`2d`
- 2日以上3日未満：`3d`
- 3日以上7日以内：`7d`
- 7日超：通知しない

時間通知は `hourly-24`～`hourly-1` です。残り24時間ちょうどは時間通知ではなく `2d`、残り23時間59分59秒は `hourly-24`、残り59分59秒は `hourly-1` です。2日未満では `2d` を優先するため、同じ時点で `7d` は送りません。Cron停止後も過去の区分をまとめて送らず、復旧時点の区分だけを送ります。

通知履歴の主キーはsource、event ID、期限Unix秒、通知種別です。期限変更後は新しい期限として通知できます。送信は次のクレーム方式で重複と欠落を抑えます。

1. 15分以上古い `pending` クレームを削除する
2. `INSERT OR IGNORE` で現在の通知をクレームする
3. 取得できた実行だけDiscordへ送信する
4. 成功時は `sent` に更新する
5. 失敗時はクレームを削除し、次回Cronで再試行する

通知先はDiscord API v10のチャンネルメッセージAPIです。`DISCORD_MENTION` は `<@USER_ID>` または `<@&ROLE_ID>` だけを認め、`allowed_mentions.parse` は常に空配列にします。不正形式や未設定時はメンションを一切許可しません。

## 5. D1

`migrations/0001_initial.sql` は次のテーブルを作成します。

- `assignments`：課題。主キーはsourceとevent ID
- `sync_runs`：同期時刻、受信件数、完全同期フラグ
- `reminder_logs`：期限ごとの通知クレーム・送信履歴

今後のアクティブ課題と古いpendingクレームの検索用インデックスを持ちます。SQL値はすべてPrepared Statementでバインドします。

## 6. Tampermonkey

`userscript/science-tokyo-lms-sync.user.js` はMoodleの `core/ajax` から `core_calendar_get_action_events_by_timesort` を呼び出します。手動同期ボタン、メニューからの同期、6時間ごとの自動同期、コンソール表、成功・失敗表示を備えます。

Tampermonkeyへコピーした後、そのコピーだけで次を設定します。

```js
// @connect      <worker-domain（https://なし）>
const API_BASE = "https://<worker-domain>";
const SYNC_TOKEN = "<Cloudflareに登録したSYNC_TOKEN>";
```

`@match` はLMS全体ですが、実行時に `/YYYY/` を検証し、`science-tokyo-lms-YYYY` を生成します。リポジトリ側のプレースホルダーを実値へ変更してコミットしないでください。

## 7. ローカル開発

以下はWindowsのコマンドプロンプト向けです。

```cmd
npm install
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` の各プレースホルダーを設定します。`.env` と混在させません。標準のURLは `http://localhost:8787` です。

```cmd
curl http://localhost:8787/health
curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"
```

`curl` が利用できなければ、`/health` はブラウザで確認できます。Scheduled Handlerの確認URLはWranglerの起動ログに表示されたものを優先します。

```cmd
npm run typecheck
npm test
```

## 8. CloudflareとDiscordの本番設定

### 8.1 D1と設定値

```cmd
npx wrangler login
npx wrangler d1 create science-tokyo-lms-discord-bot
```

出力された `database_id` を `wrangler.jsonc` に設定します。同じファイルの `vars` またはCloudflare DashboardでApplication ID、Guild ID、Channel ID、任意のMentionを設定します。値を推測して設定しません。

```cmd
npm run db:migrate:remote
```

### 8.2 Secrets

```cmd
npx wrangler secret put SYNC_TOKEN
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
```

値は対話入力し、コマンド行やGit管理ファイルへ書きません。`DISCORD_PUBLIC_KEY` はBot TokenではなくGeneral InformationのPublic Keyです。

### 8.3 デプロイ

```cmd
npm run deploy
```

Discord Developer PortalのInteractions Endpoint URLに `https://<worker-domain>/discord/interactions` を設定します。Botを通知先サーバーへ追加し、チャンネル閲覧、メッセージ送信、Embedリンクの権限を付与します。Gateway方式は併用しません。

`.dev.vars` に本番のApplication ID、Guild ID、Bot Tokenを設定してコマンドを登録します。

```cmd
npm run register-commands
```

最後にTampermonkeyの `@connect`、`API_BASE`、`SYNC_TOKEN` を本番Worker用へ変更してLMSから同期します。

## 9. 動作確認

1. `https://<worker-domain>/health` が `ok: true` を返す
2. LMSの年度ページで手動同期を実行する
3. Discordで `/同期状態` と `/課題` を実行する
4. Cloudflare Logsで同期件数とCronの開始・終了を確認する

D1の通知履歴は空から始まるため、初回同期時に24時間未満の課題があれば、次回Cronで現在区分の通知が1回送られる可能性があります。

## 10. セキュリティ

- `.dev.vars`、`.env`、Bot Token、SYNC_TOKENをGitへ追加しない
- Secret、Discord署名、LMS認証情報をログへ出さない
- 同期APIはBearer認証、Discord InteractionsはEd25519署名検証を必須にする
- URLはScience Tokyo LMSのHTTPSホストに限定する
- SQLはPrepared Statementを使用する
- CORSを無条件に `*` へ開放しない
- エラー応答へスタックトレースやSecretを含めない
- 過去にユーザースクリプトへ実トークンを入れて共有した場合は、そのトークンを失効させる

## 11. トラブルシューティング

- 同期が `401`：TampermonkeyとCloudflare SecretのSYNC_TOKENが一致するか確認する。値をログへ貼らない
- Endpoint URLを保存できない：Public Key、Worker URL、D1マイグレーション、署名検証を確認する
- D1エラー：`wrangler.jsonc` のdatabase IDとリモートマイグレーションを確認する
- コマンドが出ない：Application ID、Guild ID、コマンド登録結果を確認する
- 通知されない：Bot権限、Channel ID、Cron Trigger、同期済み期限を確認する
