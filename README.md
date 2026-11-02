# Science Tokyo LMS 課題通知 Bot — Ubuntu版

TampermonkeyからLMS課題をUbuntuのSQLiteへ同期し、Discordで課題一覧と期限通知を提供します。Node.js 24を使います。

```text
LMSのログイン済みブラウザ
  → Tampermonkey → Tailscale → Ubuntuの同期API → SQLite
Discordのスラッシュコマンド
  → Ubuntuから接続したDiscord Gateway → SQLite → 非公開応答
systemdタイマー（5分ごと）
  → SQLiteの通知候補 → Discord REST API
```

既定のGateway構成では独自ドメインもインターネットへのポート開放も不要です。LMSを開くPCも同じTailscaleネットワークに接続してください。Tailscale内のHTTP通信はTailscaleが暗号化します。APIのBearer認証も維持します。

LMSへの自動ログインは行いません。新規課題・期限変更・削除はブラウザから同期した時点で反映されます。同期済み課題の通知はブラウザを閉じても、Ubuntuが稼働していれば継続します。

## ローカル開発（Windows CMD）

```cmd
npm install
npm run typecheck
npm test
npm run build
```

新規環境は `.env.example` を `.env` にコピーして設定します。既存の `.env` がある場合は上書きする前に保管してください。

```cmd
copy .env.example .env
npm run dev
```

Gatewayを起動する前に、Discord Developer Portalの **Interactions Endpoint URLを空欄にして保存**します。Botは既存のDiscordサーバーに参加したままで使えます。`DISCORD_OWNER_ID` が空なら、Message Content Intentなどの特権Intentは不要です（`todo:` によるタスク追加を使う場合は「タスク」の節を参照）。通常、既存のスラッシュコマンドの再登録は不要です。必要な場合は `npm run build` の後に `npm run register-commands` を実行します。

`HOST` は既定で `127.0.0.1`、ポートは `3000` です。開発時の確認先は `http://127.0.0.1:3000/health` です。APIプロセス自身は期限通知を実行しません。

## Cloudflareからの移行

切り替え前に、まずUbuntuへの配置・依存関係インストール・ビルドまで終えてください。Ubuntuのタイマーは最後に有効化します。

1. Cloudflare Dashboardの対象WorkerでCron Triggerを停止します。変更反映には時間がかかるため、最大15分を見込み、実行中のCronが完了したことも確認します。Ubuntuの通知タイマーはまだ有効にしません。
2. 切り替え中はTampermonkeyの同期操作を控え、D1の最終スナップショットを書き出します。
3. SQLをUbuntuへ転送し、新しいSQLiteファイルに取り込みます。課題・同期履歴に加え、通知履歴も保持します。
4. Discordの既存Interactions Endpoint URLを記録したうえで空欄にして保存します。
5. UbuntuのAPI・Gatewayサービスを起動し、`/health`、Discordの `/課題` と `/同期状態` を確認します。
6. Tampermonkeyを新しい同期先に切り替えて同期を確認します。
7. Ubuntuの通知タイマーを有効にします。

D1を書き出すPCでは、一時的にWranglerを使います。Wranglerスキルの手順と公式ドキュメントに従ってログインしてください。Ubuntuでの通常運転にWranglerは不要です。`wrangler.jsonc` は既存D1の指定を残すためのファイルです。新しい `src/index.ts` はNode.js用なので、Cloudflareへデプロイしないでください。

```cmd
npx --yes wrangler@4 d1 export science-tokyo-lms-discord-bot --remote --output data/d1-export.sql
```

既存の `.dev.vars` と `wrangler.jsonc` から、秘密値を表示せずUbuntu用の設定ファイルを作れます。既存ファイルは上書きしません。`.dev.vars` に現在の本番トークンが設定されていることを確認してください。

```cmd
npm run build
npm run env:migrate -- data/ubuntu.env 100.126.148.41
```

生成した `data/ubuntu.env` の `HOST` はTailscale IP、DBは `/var/lib/lms-bot/lms.sqlite` になります。生成ファイル・SQL・バックアップはGit管理対象外です。

## Ubuntuへの導入

Node.js **24系**、npm、systemdが必要です。既定の実行パスは `/usr/bin/node` です。別の場所に配置する場合は `sudo NODE_BINARY=/absolute/path/to/node bash deploy/install.sh` のように指定すると、サービスファイルにもその実行パスを反映します。

ソース一式を `/opt/science-tokyo-lms-discord-bot` に配置します。`.env`、`.dev.vars`、Windowsの `node_modules`、`.git` はソースアーカイブに含めず、秘密設定は別に転送してください。サーバー側で以下を実行します。

```bash
cd /opt/science-tokyo-lms-discord-bot
npm ci
npm run typecheck
npm test
npm run build
sudo bash deploy/install.sh
```

インストーラーは `lms-bot` 専用ユーザー、保存先、systemdユニット、設定ファイルの雛形を用意します。サービスは自動で開始しません。既存の `/etc/lms-bot.env` は上書きしません。

準備した `ubuntu.env` と `d1-export.sql` を、SSHで転送したユーザーのホームに置いた場合：

```bash
sudo install -m 600 ~/ubuntu.env /etc/lms-bot.env
sudo install -m 600 -o lms-bot -g lms-bot ~/d1-export.sql /var/lib/lms-bot/d1-export.sql
sudo -u lms-bot /usr/bin/node dist/scripts/import-d1.js /var/lib/lms-bot/d1-export.sql /var/lib/lms-bot/lms.sqlite
```

インポートは既存DBの上書きを拒否し、一時DBへの取り込み・整合性検証が成功してから保存します。新規に始める場合はインポートを省略できますが、通知履歴が空なので現在の通知区分で再通知される可能性があります。API・通知ジョブの初回実行時にスキーマが作成されます。

`/etc/lms-bot.env` で `HOST` をサーバーのTailscale IPに設定します。`0.0.0.0` ではなくTailscaleのアドレスだけにバインドすることで、他のネットワークへの意図しない公開を避けます。Tailscale IPへバインドする構成では、サーバー再起動後もTailscaleが起動するようにしてください。ファイアウォールやTailscaleのアクセス制御がある場合は、同期するPCからのTCP 3000番アクセスを許可します。

Discord側のEndpoint URLを空欄にした後：

```bash
sudo systemctl enable --now lms-bot.service
curl http://100.126.148.41:3000/health
sudo journalctl -u lms-bot.service -n 50 --no-pager
```

`Discord gateway ready` を確認し、Discordでコマンドを実行してください。HTTP Endpointがまだ設定されている場合、Gatewayは起動を拒否して設定変更を案内します。

Tampermonkeyの同期確認後、Cloudflareの通知が停止していることを確認してから：

```bash
sudo systemctl enable --now lms-bot-reminders.timer
systemctl list-timers lms-bot-reminders.timer
sudo journalctl -u lms-bot-reminders.service -n 50 --no-pager
```

タイマーは5分ごとに実行し、停止中の実行回数を一括再生しません。復帰時点の通知区分だけを処理します。同一ジョブが動作中の間は次のジョブを重ねて起動しません。

## Tampermonkey

`userscript/science-tokyo-lms-sync.user.js` の内容で、インストール済みスクリプトを更新してください。

- `API_BASE`：`http://100.126.148.41:3000`
- `@connect`：`100.126.148.41`（ホスト名・IPのみ。ポート不要）
- `SYNC_TOKEN`：Ubuntuと同じ値。実値はTampermonkey上にだけ設定し、Gitへ入れません。

Tailscale Serveを使ってプライベートHTTPSで公開する場合は、`HOST=127.0.0.1` へ戻し、Serveの `.ts.net` URLとそのホスト名を設定してください。Funnelによる一般公開は不要です。

LMSの課題画面で「Discordに同期」を押し、Discordの `/同期状態` を確認します。同期ボタン・6時間ごとの自動同期・50件取得時の不完全同期の扱いを維持しています。LMSのCookie、sesskey、パスワードは送信しません。

## 通知仕様

締切まで24時間未満は1時間ごとの区分、2日未満は `2d`、3日未満は `3d`、3日以上7日以内は `7d` の通知を送ります。1課題につき現在の区分だけを通知し、同じ期限・同じ区分をSQLiteの履歴で重複排除します。期限変更後は新しい期限として扱います。

既存の色・絵文字による緊急度表示を維持します。24時間以内の通知だけが設定済みユーザーまたはロールをメンションし、`@everyone` と `@here` は許可しません。`/同期状態` は24時間・3日・7日以内の件数と、最終同期から24時間以上経過した場合の警告を表示します。

`/課題` の結果の下にあるメニューから課題を選ぶと、その課題のリマインドを停止できます（もう一度選ぶと再開）。課題は削除されず、一覧には「🔕 リマインド停止中」と表示されます。停止は課題ごと（source・event_id）に保存され、同期や期限変更でも解除されません。メニューは締切の近い25件までです。

## タスク（todo:）

Botが参加しているチャンネルに `todo:タスク名` と送ると、そのタスクを登録します（全角の `：` も可）。Botの返信の **📅 期限を設定** ボタンを押すと入力欄が開くので、日本時間で期限を入力します。`11/10 23:59`、`2026-11-10 18:00`、`11/10`（時刻を省略すると23:59）の形式に対応しています。年を省略した場合は、次に来るその日付を使います。**✅ 完了** で完了にします。未完了のタスクは `/課題` の課題一覧の下に表示されます。タスクには期限通知を送りません。

登録できるのは `DISCORD_OWNER_ID` に設定したユーザーだけです。ほかのユーザーのメッセージは無視し、ボタンは操作を拒否します。この機能はGatewayモード専用です。有効にする手順：

1. Discord Developer PortalのBot設定で **Message Content Intent** をオンにして保存します。オフのまま `DISCORD_OWNER_ID` を設定すると、Gatewayのログインに失敗します。
2. 自分のDiscordユーザーID（開発者モードで「ユーザーIDをコピー」）を `/etc/lms-bot.env` の `DISCORD_OWNER_ID` に設定します。
3. サービスを再起動します。タスク用のテーブルは起動時に自動作成されます。

```bash
sudo systemctl restart lms-bot.service
```

送信失敗時は次回チェックで再試行できます。プロセス異常終了などで残ったpendingは15分後に再取得可能です。Discord送信とSQLite更新は単一トランザクションにできないため、送信成功直後に異常終了すると重複する可能性は残ります。

## Ubuntuのターミナルで課題を表示

Python 3の標準ライブラリだけで動く読み取り専用コマンドです。SSHでログインするユーザーに一度だけ配置します。

```bash
cd /opt/science-tokyo-lms-discord-bot
install -Dm700 deploy/lms.py ~/.local/bin/lms
source ~/.profile
lms
```

`lms` は有効な課題のうち、これから締切を迎える課題を締切順で表示します。授業名、課題名、日本時間の締切、URLと最終同期時刻が分かります。

```bash
lms --all   # 期限切れを含む有効な課題
lms --json  # JSON形式
lms --help
```

DBの権限は変えず、必要なときだけ `sudo -u lms-bot` で読み取るため、通常のsudo認証が必要です。`lms` の表示対象はSQLiteに保存済みのデータです。LMSから新しい情報を取り込むには、ブラウザで従来どおり同期します。別のDBやバックアップを読む場合は `lms --database /path/to/backup.sqlite` を使えます。

## バックアップ・運用・切り戻し

稼働中のDBはSQLiteのバックアップAPIでコピーします。WALファイルを無視してDB本体だけをコピーしないでください。

```bash
cd /opt/science-tokyo-lms-discord-bot
sudo -u lms-bot env DATABASE_PATH=/var/lib/lms-bot/lms.sqlite /usr/bin/node dist/scripts/backup-database.js /var/lib/lms-bot/backup.sqlite
sudo systemctl restart lms-bot.service
sudo journalctl -u lms-bot.service -f
```

バックアップの保存先は毎回別名にしてください。バックアップは別の保存先にも保管します。Node.js 24の一部バージョンでは `node:sqlite` の実験的機能警告が出ます。

切り戻す場合は、Ubuntuの通知タイマーと実行中の通知ジョブを停止し、APIも停止します。TampermonkeyのURLとDiscordのEndpoint URLを旧Workerへ戻してLMSから再同期し、その後でCloudflareのCronを再開します。Botトークンを再発行した場合は、Cloudflareの `DISCORD_BOT_TOKEN` Secretも新しいトークンで更新してからCronを再開してください。Ubuntu稼働中の通知履歴はD1へ自動で戻らないため、切り戻し直後に現在区分の通知が再送される可能性があります。WorkerとD1は移行確認が済むまで削除しません。

## HTTP Interactions方式を使う場合

`DISCORD_MODE=http` と有効な `DISCORD_PUBLIC_KEY` を設定すると、既存の `/discord/interactions` を署名検証付きで利用できます。この方式はDiscordから到達できる公開HTTPS URLが必要です。Gatewayとの同時受信は行いません。独自ドメインを使わない通常のTailscale構成では `gateway` を使います。

## 参考資料

- [Cloudflare D1のエクスポート](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Discord Gateway](https://docs.discord.com/developers/events/gateway)
- [Node.js 24 SQLite](https://nodejs.org/download/release/v24.11.0/docs/api/sqlite.html)
- [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)

今回のサーバー固有の配置先・検証結果は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。
