# Sweet DAW iPhone実機 A/B・奥行き確認手順

作成日: 2026-06-17

## 目的

iPhone Safari / PWA実機で、Sweet DAWのA/B確認、奥行き処理、WAV書き出しが意図通りに動くか確認する。

今回の確認対象は以下。

- AIMIXのBefore/Afterが正しく切り替わること
- FIX後の状態が書き出しWAVへ反映されること
- MasterBusの音量処理がLimiter前に入り、Limiter後に過剰な音量が乗らないこと
- Reverb / IR / Spatial系の奥行き処理で、低域や中低域が濁りすぎないこと
- iPhone縦画面で最後の書き出し操作までスクロールできること

## 今回の変更点

- Master gainをLimiterの前に移動した。
- `Sweet Reverb Lite` に以下の調整項目を追加した。
  - Pre Delay
  - Low Cut
  - High Cut
  - Width
- ライブ再生とOffline exportのAmbience Bus設定を揃えた。
- Reverb Liteに実用プリセットを追加した。
  - Support Depth
  - Vocal Plate Safe
  - Wide FX Tail
  - Small Room

## iPhone実機確認手順

1. iPhoneで公開中のSweet DAWをSafariまたはPWAホーム画面から開く。
2. Sunoのstem一式を読み込む。
3. 直WAVがある場合は、Referenceとして読み込む。
4. 読み込み後、全クリップが移動ロックされていることを確認する。
5. `AIMIX`を開く。
6. 直WAVへ近づける場合は `Reference Match` を選ぶ。
7. 直WAVよりクリーンに再構築したい場合は `Clean Rebuild` を選ぶ。
8. `AIMIX提案` を実行する。
9. A/BでBeforeとAfterを切り替えて聴く。
   - Before: 元のstem合算に近い状態
   - After: AIMIX後の状態
10. Afterの方が良ければ `FIX` する。
11. 奥行きを足す場合は、先にAIMIXをFIXしてから `Spatial` を使う。
12. Reverbを使う場合は、基本的にVocal / Bass / Kickには強く入れない。
13. Reverb Liteを使う場合は、最初は以下を目安にする。
   - Room: 32-45%
   - Damp: 55-70%
   - Pre Delay: 12-22ms
   - Low Cut: 180-240Hz
   - High Cut: 7-10kHz
   - Width: 35-50%
   - Mix: 10-18%
14. 書き出しWAVを作成する。
15. 書き出したWAVを再読み込みし、Reference音声が混ざっていないことを確認する。
16. iPhoneスピーカー、イヤホン、PC再生で音量・低域・ボーカル位置・広がりを比較する。

## 合格条件

- A/B切り替えで画面が固まらない。
- FIXした内容がWAV書き出しへ反映される。
- Referenceトラックの音そのものは書き出しに混ざらない。
- Master gainがLimiter後に乗って音割れしない。
- Reverbで180-600Hzのこもりが増えすぎない。
- Bass / Kick / Lead Vocalが中央に残る。
- Support / Synth / FXにだけ自然な奥行きや広がりが付く。
- iPhone縦画面で書き出しボタンまでスクロールできる。

## 注意

このリポジトリ上の自動テストでは、実際のiPhoneスピーカーやイヤホンでの聴感までは確認できない。
最終判断は必ずiPhone実機で行う。
