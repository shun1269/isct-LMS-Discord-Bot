# Science Tokyo LMS 課題通知 Bot

Science Tokyo LMS の課題情報をTampermonkeyからCloudflare D1へ同期し、Discordで課題一覧の表示と期限通知を行う個人用Bot。

## 期限通知

期限までの残り時間に応じて、現在の区分だけを通知します。24時間未満は1時間区分、2日未満は「2日」、3日未満は「3日」、3日以上7日以内は「7日以内」です。この優先順位により、2日未満の課題へ「7日以内」を重ねて通知しません。

変更をCloudflareへ反映するには、型検査とテストの後にデプロイします。

```cmd
npm run typecheck
npm test
npm run deploy
```
