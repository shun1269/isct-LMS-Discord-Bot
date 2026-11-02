# Science Tokyo LMS 課題通知 Bot 詳細

Ubuntuへの移行に伴い、導入・API・通知仕様は [README.md](README.md) に統合しました。

## HTTPルート

| Method | Path | 内容 |
|---|---|---|
| GET | /health | 稼働確認と最終同期の概要。課題本文・Secretは返さない |
| POST | /api/v1/assignments/sync | Bearer認証とZod検証を行う課題同期 |
| POST | /discord/interactions | `DISCORD_MODE=http` の場合のみ受信。Ed25519署名検証必須 |

本文上限は256 KiB、課題件数は最大500件。認証不正は401、Content-Type不正は415、サイズ超過は413、入力不正は400、未知のルートは404。

`src/schemas.ts` がペイロード仕様、`migrations/0001_initial.sql` がテーブル仕様の基準です。既存のsource・eventIdなどの同期フィールドとUnix秒での期限計算を維持しています。

SQLiteはWALとbusy timeoutを使用します。`app_migrations` でスキーマ適用を管理し、同期バッチの失敗時は非アクティブ化も含めてロールバックします。APIと通知ジョブは別の接続を使い、通知のクレームは主キーで排他します。

Gatewayのコマンドは設定済みGuildだけで処理し、Ephemeralで応答します。HTTP方式とGateway方式は同時に有効にしません。Gateway移行時はDiscord側の既存Endpoint URLを空欄にします。

## 主なファイル

- `src/database.ts`：SQLite接続、トランザクション、マイグレーション
- `src/config.ts`：環境変数検証
- `src/http-server.ts` / `src/router.ts`：HTTPサーバー、サイズ制限、ルーティング
- `src/gateway.ts` / `src/commands.ts`：Gatewayと共有コマンド処理
- `src/repository.ts`：同期、課題取得、通知クレーム
- `scripts/import-d1.ts`：D1 SQLを新規SQLiteへ安全に取り込む
- `scripts/backup-database.ts`：稼働中のSQLiteを整合性のある状態でバックアップ
- `deploy/systemd/`：常駐サービスと通知タイマー
