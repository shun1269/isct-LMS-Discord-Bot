# Science Tokyo LMS → Discord 課題通知Bot

Science Tokyo LMS（Moodle）にログイン済みのブラウザから課題名・期限・リンクを取得し、ローカルの同期APIへ保存して、Discordで一覧表示・期限前通知を行う最小構成です。

## 構成

```text
Science Tokyo LMS
  ↓ Tampermonkey（ログイン済みブラウザ）
POST /api/v1/assignments/sync
  ↓
Node.js + Express + SQLite
  ↓
Discord Bot
  ├─ /課題
  ├─ /同期状態
  └─ 7日前・24時間前・3時間前の通知
```

LMSのCookie、`sesskey`、大学アカウントのパスワードはサーバーへ送りません。

## 必要環境

- Node.js 24 LTS
- npm
- Discordのテスト用サーバー
- Tampermonkey

## 1. セットアップ

PowerShellでプロジェクトフォルダを開きます。

```powershell
npm install
Copy-Item .env.example .env
```

同期用トークンを生成します。

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

生成された文字列を `.env` の `SYNC_TOKEN` に設定します。

## 2. Discord Botを作成

Discord Developer PortalでアプリケーションとBotを作成し、次を `.env` に設定します。

```dotenv
DISCORD_BOT_TOKEN=Botタブのトークン
DISCORD_CLIENT_ID=General InformationのApplication ID
DISCORD_GUILD_ID=開発用DiscordサーバーのID
DISCORD_CHANNEL_ID=通知先テキストチャンネルのID
```

通知時に自分をメンションする場合は次のように設定します。

```dotenv
DISCORD_MENTION=<@自分のDiscordユーザーID>
```

ロールへ通知する場合は次の形式です。

```dotenv
DISCORD_MENTION=<@&ロールID>
```

Botをサーバーに追加するときは、`bot` と `applications.commands` を許可し、少なくとも次の権限を付けます。

- View Channel
- Send Messages
- Embed Links

## 3. スラッシュコマンドを登録

```powershell
npm run register-commands
```

開発中はGuildコマンドとして登録するため、通常はすぐに反映されます。

## 4. APIとBotを起動

```powershell
npm run dev
```

次の表示が出れば起動成功です。

```text
Sync API listening on http://127.0.0.1:3000
Discord bot logged in as ...
```

ブラウザで次を開くと稼働状態を確認できます。

```text
http://127.0.0.1:3000/health
```

## 5. Tampermonkeyスクリプトを設定

`userscript/science-tokyo-lms-sync.user.js` をTampermonkeyの新規スクリプトへ貼り付けます。

先頭付近の次の2項目を変更します。

```js
const API_BASE = "http://127.0.0.1:3000";
const SYNC_TOKEN = "ここを.envのSYNC_TOKENと同じ値に変更";
```

Science Tokyo LMSを開くと、右下に「課題をDiscordへ同期」ボタンが表示されます。クリックすると課題データがSQLiteへ保存されます。

## 6. Discordで確認

Discordで次を実行します。

```text
/課題
```

日本語ローカライズが反映されないクライアントでは `/assignments` と表示される場合があります。

最終同期状態は次で確認できます。

```text
/同期状態
```

## 通知仕様

Botは1分ごとに期限を確認し、次のタイミングで通知します。

- 7日前
- 24時間前
- 3時間前

Botが一時停止していた場合、再起動時点で該当する最も近い通知を1件だけ送ります。同じ課題・同じ期限・同じ通知種別はSQLiteの履歴によって重複送信されません。

期限がLMS側で変更された場合は、期限時刻を含めて通知履歴を区別するため、新しい期限について再通知されます。

## 注意事項

- 方法Bでは、LMSをブラウザで開いて同期した時点の情報がBotへ反映されます。
- PCを終了するとAPIとBotも停止します。24時間運用は、後からVPSや常時起動PCへ移行してください。
- `SYNC_TOKEN`、`DISCORD_BOT_TOKEN`、`.env` をGitHubへコミットしないでください。
- `userscript` に書いた同期トークンも第三者へ共有しないでください。
- 現在の取得上限は50件です。50件ちょうど取得した場合は不完全同期として扱い、既存課題を非アクティブ化しません。

## 本番ビルド

```powershell
npm run build
npm start
```
