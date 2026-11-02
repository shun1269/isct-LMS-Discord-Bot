# Ubuntu導入記録

実施日：2026-10-25（日本時間）

## 接続・配置

| 項目 | 値 |
|---|---|
| SSH | samidare@100.126.148.41 |
| OS | Ubuntu 26.04.1 LTS / x86_64 |
| Node.js | 24.22.1。公式配布のSHA256を確認して導入 |
| Node実行パス | /opt/lms-bot-node-v24.22.1/bin/node |
| アプリ | /opt/science-tokyo-lms-discord-bot |
| 実行ユーザー | lms-bot |
| 秘密設定 | /etc/lms-bot.env（rootのみ読み書き可能） |
| SQLite | /var/lib/lms-bot/lms.sqlite |
| 同期API | http://100.126.148.41:3000 |
| 常駐サービス | lms-bot.service |
| 通知タイマー | lms-bot-reminders.timer（5分ごと） |

APIはTailscale IPだけにバインド。ブラウザを使うPCも同じTailscaleネットワークに接続する。DiscordはGateway方式で、公開HTTPS Endpointと独自ドメインは不要。

## データと認証

D1から課題76件、通知履歴555件、同期履歴180件を取り込んだ。通知履歴を保つことで、同じ区分での再通知を避ける。

Botトークンはユーザー操作で再発行。Ubuntuへ新しいトークンを設定した。旧Cloudflareは新トークンを保持していないので、Cron設定反映待ちの実行が残っても旧トークンではDiscordへ投稿できない。Cronが0件であることもCloudflare APIから確認した。

Discordの旧HTTP Interactions Endpointを空に変更し、Gatewayへ切り替えた。元のEndpointはサーバーの `/home/samidare/lms-migration/discord-before.json` に記録した。

旧 `.env` と `.dev.vars` は保存したまま。そのBotトークンは現在無効なので、開発用に再利用する際は新しいトークンを設定する。運用上の正本はサーバーの `/etc/lms-bot.env`。ローカルの移行用コピーは `data/ubuntu.env`。値はGitへ追加しない。

## 検証済み

- WindowsとUbuntuの両方で型検査・60件のテスト・ビルドが成功。
- ビルド済みアプリのHTTP同期、SQLiteへの保存、再起動後のデータ保持を確認。
- Ubuntu上で実際のD1 SQLを取り込み、データ件数を確認。
- systemdサービス・タイマーはactiveかつenabled。
- Discord Gateway接続完了をサーバーログで確認。
- WindowsからTailscale経由の `/health` が200。
- 初回通知チェックは2026-10-25 15:45 JST。候補5件、送信0件、処理失敗0件。既存の通知履歴が維持されている。

Tampermonkeyはユーザーが設定済みファイルへ更新済み。2026-10-25 15:48:53 JSTに19件の完全同期がUbuntuへ届いたことを `/health` とサーバーログで確認した。Discordの assignments / sync-status の登録も確認済み。設定済みファイルはローカルの `data/science-tokyo-lms-sync-ubuntu.user.js` に保存しているが、同期トークンを含むためGit管理対象外。

## ターミナルから課題を見る

`/home/samidare/.local/bin/lms` に一覧コマンドを配置済み。現在開いているシェルでは最初に `source ~/.profile` を実行すると、以後 `lms` だけで呼び出せます。SSHへ入り直した場合は自動でPATHに入ります。

```bash
lms         # 今後の課題を締切順・日本時間で表示
lms --all   # 期限切れを含む有効な課題
lms --json  # JSON形式
```

DBは `/var/lib/lms-bot/lms.sqlite` のまま。権限も維持し、必要なときだけsudo認証後に専用ユーザー `lms-bot` で読み取ります。LMSへ直接アクセスせず、最後に同期した内容を表示します。コマンドのソースは `deploy/lms.py`。移行用DBの有効な課題19件で互換性を確認し、一時DBで絞り込み・ソート・日本時間・JSON・DBを変更しないことを検証済み。本番DBの表示はsudo認証を伴うため、ユーザーのターミナルで実行します。復旧DBでも実際の19件の表示を確認済み。

## 運用コマンド（Ubuntu）

```bash
systemctl status lms-bot.service --no-pager
systemctl list-timers lms-bot-reminders.timer --no-pager
journalctl -u lms-bot.service -u lms-bot-reminders.service -n 50 --no-pager
curl http://100.126.148.41:3000/health
```

DBの整合性を保ったバックアップ：

```bash
cd /opt/science-tokyo-lms-discord-bot
sudo -u lms-bot env DATABASE_PATH=/var/lib/lms-bot/lms.sqlite /opt/lms-bot-node-v24.22.1/bin/node dist/scripts/backup-database.js /var/lib/lms-bot/backup-YYYYMMDD.sqlite
```

保存先は毎回別名を使う。`/var/lib/lms-bot` と `/etc/lms-bot.env` は別の保存先へもバックアップする。

## DB破損と復旧（2026-10-25）

`lms` の配置確認で `/health` のHTTP 500を検出。通知ジョブは16:05まで成功し、16:10以降失敗していた。読み取り専用診断でDB本体が192511バイトとなっており、`database disk image is malformed` を確認した。破損原因は断定していない。

APIと通知を停止し、DB本体・WAL・SHMを `/home/samidare/lms-migration/recovery-STZ5tBa7` へ退避。原本には手を加えず、内容が同一だったD1エクスポート由来の正常な移行用DBと、保存したWALから別ファイルの復旧候補を作成した。

全体整合性検査と外部キー検査が成功し、課題76件（有効19件）、同期履歴182件、通知履歴557件を確認。移行済みの送信履歴555件と、16:00に送った2件も全件保持できていることを照合した。最新同期は2026-10-25 15:48:53 JST。復旧候補を `lms` で読み取り、19件の授業名・課題名・日本時間の期限・URLの表示も確認した。

ユーザーがsudo認証で反映スクリプトを実行。SHA256と整合性・件数を再検証後、元ファイルを追加退避してから `/var/lib/lms-bot/lms.sqlite` へ復元した。所有者・権限は専用ユーザー `lms-bot` のまま。16:24 JSTに `/health` の正常応答とサービス・タイマーのactiveを確認。

- 退避した原本・WAL・SHM：`/home/samidare/lms-migration/recovery-STZ5tBa7/`
- 反映直前の追加退避：同ディレクトリの `before-install-Xcu91MVg/`
- 検証結果：同ディレクトリの `recovery-manifest.json`
- 検証済み復旧DB：同ディレクトリの `recovered.sqlite`

SQLiteはテキストではないため、nano等では編集しない。閲覧には `lms` を使い、バックアップはSQLiteのバックアップAPIを使う。

## 切り戻し

Ubuntuの通知タイマーと実行中の通知ジョブを停止し、APIも停止する。Cloudflare Secretへ新しいBotトークンを設定し、Discordの旧EndpointとTampermonkeyの旧同期先を復元する。LMSを再同期してから旧Cronを再開する。Ubuntu運用中の通知履歴は自動でD1へ戻らないため、現在区分で再送される可能性がある。WorkerとD1は切り戻し用に残している。
