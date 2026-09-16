# Sweet DAW Mix Decision Layer

Decision Layerは、ミックス記事や実務的な判断をSweet DAW内の診断ロジックとして抽象化した層です。
Phase 1では音を大きく変えるDSPではなく、AIMIX / Mix Doctor / Auto Reference Mixが安全に判断するためのレポートを追加します。

## Phase 1の目的

- 低域の主役を1つに決める
- KickとBassを同じ20-60Hz帯域で同時に主役にしない
- Limiterで音圧を稼ぐ前に、どのstemがピークを先に叩いているか確認する
- Airを足す前に、Sub / Low-Mid / Presence / Side-Midの問題を確認する
- Referenceは比較と診断に使い、最終mixへ混ぜない

## Low-End King

Low-End Kingは、20-60Hzを誰が担当しているかを判定します。

- Bassが主役なら、Kickは80-120Hz以上のAttack帯域を中心に扱う
- Kickが主役なら、Bassは80-160Hzのbodyを中心に扱う
- DrumsとBassの両方が20-60Hzで強い場合は、LimiterやMaster gainを押す前に整理する
- Music / Other / Synth / FXなどsupport stemに不要なSubがある場合は、wideningやreverb前に軽く整理する

Phase 1では、低域を直接削る処理は最小限です。
主にAutoPluginPlannerがsub boost、ambience send、support widthを安全側へ弱める材料として使います。

## Peak Culprit

Peak Culpritは、Limiterを先に叩いているstemを探します。

- True Peakが-1dB付近でCrestが高い場合は、Limiterを押す前にピーク処理が必要
- DrumsのCrestが高い場合は、Transient shapingを優先する
- BassがLimiterを押している場合は、低域ピークを整理してからMaster gainを足す
- LUFSが足りないのにTrue Peakが近い場合は、Master gainではなくdensity / clip / shapeを先に検討する

Phase 1では、新しいClipper DSPは追加しません。
既存のTransient Shaper、Parallel Comp、Bass Enhancer、Master gain推奨を安全側に寄せます。

## UI表示

Mix Doctor画面に以下のカードを表示します。

- Low-End King: owner / status / low risk / short recommendation
- Peak Culprit: status / top culprit / action / limiter risk

どちらも診断カードです。
表示された内容は、A/B確認やFIX前の判断材料として使います。

## 今回変更しないこと

- Reference音声をmixへ混ぜる処理
- Spatial / IR / 3D定位の新規追加
- MasterBusの信号順
- Magic PolishのDSPチェーン
- 強いLimiterやClipperの追加

## Phase 2候補

- sweet-clipperの安全設計
- Peak CulpritからTransient Shaper / Clipper提案をより細かく出す
- Low-End Kingの結果をEQ補正候補へ変換する
- Rendered mixを使ったbefore/after Damage Guardとの統合強化

## Phase 3-5 addendum

Phase 3-5 adds three conservative decision-layer tools:

- Sweet Low-End Translator: bass-only low-end audibility harmonics. It avoids direct 20-60Hz boost and stays blocked when Low-End King or Peak Culprit is unsafe.
- Ambience Seat Planner: keeps vocal, bass, and kick dry while sending only clean support tracks to the existing ambience bus.
- Sweet Tilt EQ: broad track/master tone tilt. Single File Mastering now runs Safety HPF -> Tilt Balance -> Tone Cleanup -> Harshness Guard -> Glue -> Clipper -> Target LUFS -> True Peak Limiter.

Detailed notes are in `docs/SWEET_DAW_PHASE_03_05_REPORT.md`.
