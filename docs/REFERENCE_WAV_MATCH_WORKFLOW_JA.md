# Sweet DAW 直WAVへ近づける使い方

作成日: 2026-06-17

## 結論

現状で直WAVに最も近づけたい場合は、以下の順番で使う。

```txt
Filesでstemと直WAVを読み込む
→ AIMIXでReference Match
→ A/B確認
→ FIX
→ Magic PolishでReferenceをターゲットに音量を合わせる
→ 必要な場合だけSpatial
→ WAV書き出し
```

`Clean Rebuild` は「直WAVを完全コピーする」用途ではなく、Sunoのクリーンstemを使って直WAVより整理された2mixを作る用途。
直WAVに近づけたい時は、まず `Reference Match` を使う。

## どれを選ぶべきか

### 直WAVに近づけたい

選ぶもの:

- AIMIX: `Reference Match`
- Magic Polish Target: `Reference`
- Reference Gain: `Reference一致`
- Pan Design: `Reference+`
- Hard Limit: まずOFF、音割れが怖い場合だけON

使わない方がよいもの:

- `Dense`
- 強いReverb
- 強いIR
- 強いSpatial
- Vocal / Bass / Kickへの強いWidener

### 直WAVよりクリーンにしたい

選ぶもの:

- AIMIX: `Clean Rebuild`
- Magic Polish Target: `Reference` または `Spotify`
- Spatial: `Spatial Auto`

目的:

- 低域を暴れさせない
- 250Hz-1kHzのこもりを増やさない
- Vocal / Bass / Kickを中央に残す
- Synth / Keys / Other / FXを左右や奥行きへ逃がす

### とにかく安全に軽く整えたい

選ぶもの:

- AIMIX: `Safe`
- Magic Polish: `Safe`
- Hard Limit: ON

## 詳細手順

### 1. ファイルを読み込む

1. Sunoのstem一式を読み込む。
2. 直WAVも読み込む。
3. 数字から始まるファイルはstemとして扱う。
4. 数字から始まらない曲名WAVはReferenceとして扱う。

例:

```txt
0 Lead Vocals.wav      → stem
1 Backing Vocals.wav   → stem
2 Drums.wav            → stem
ナリヒビク.wav          → Reference
```

Referenceは解析用の目標音源。
通常の書き出しWAVにはReferenceそのものの音は混ざらない。

### 2. AIMIXでReference Matchを選ぶ

直WAVに近づけたい時は、AIMIX画面で `Reference Match` を選ぶ。

このモードで行うこと:

- stem全体の音量バランスをReferenceへ寄せる
- 低域、こもり、Presence、Airの傾向をReferenceへ寄せる
- Stereo widthやSide/Midの傾向をReferenceへ寄せる
- Referenceトラック自体は加工しない

この段階では、まだFIXしない。

### 3. A/Bで聴く

`A/B` で必ずBeforeとAfterを聴き比べる。

確認すること:

- Vocalが遠くなっていないか
- Bassの芯が減っていないか
- 250Hz-1kHzが増えてこもっていないか
- 8kHz以上が痛くなっていないか
- Stereoが広がりすぎて中央が薄くなっていないか
- Referenceに近づいているか

Afterが良ければ `FIX` する。
Afterが悪ければFIXしない。

### 4. Magic PolishでReferenceを選ぶ

FIX後、Magic Polish側でTargetを `Reference` にする。

推奨:

- Target: `Reference`
- Reference Gain: `Reference一致`
- Hard Limit: OFFから試す
- 音割れやピークが怖い時だけHard Limit ON

重要:

Referenceに近づけたい場合、余計なPolish量の調整より `Reference Gain` を優先する。
音が小さくなりすぎる場合は、Reference Gainが丸められていないか、Hard Limitで抑えすぎていないかを確認する。

### 5. Spatialは最後に使う

Spatialは、Reference MatchとMagic Polishで音量・帯域・密度を整えた後に使う。

推奨:

- Spatial: `Spatial Auto`
- Pan Scene: `Pro Balanced`
- Pan Mode: `Reference+`
- Protect Lead Vocal: ON
- Protect Low End: ON
- Center Protect: 80-90%

使いすぎ注意:

- Spaceを上げすぎるとReferenceから離れる
- Depthを上げすぎるとVocalが遠くなる
- Bass / Kickを広げると低域が弱くなる

### 6. Reverb / IRは補助として使う

直WAVに近づけたい時、Reverb / IRは主役にしない。
基本はSupport / FX / Synth / Backing Vocalへ薄く使う。

最初の推奨値:

```txt
Room: 32-45%
Damp: 55-70%
Pre Delay: 12-22ms
Low Cut: 180-240Hz
High Cut: 7-10kHz
Width: 35-50%
Mix: 10-18%
```

避けること:

- Lead Vocalへ深いReverbを入れる
- Bass / KickへReverbを入れる
- Masterへ強いIRを入れる
- 180-600Hzが増える設定にする

## 現状の推奨ルート

### 直WAVに最も近い結果を狙うルート

```txt
1. Filesでstem一式を読み込む
2. Filesで直WAVを読み込む
3. AIMIXを開く
4. Reference Matchを選ぶ
5. AIMIX提案を実行
6. A/BでAfterを確認
7. 良ければFIX
8. Magic PolishでTargetをReference
9. Reference GainをReference一致
10. Hard LimitはOFFから試す
11. WAV書き出し
12. 書き出したWAVを再読み込みしてReferenceと比較
```

### 直WAVより整理された2mixを狙うルート

```txt
1. Filesでstem一式を読み込む
2. Referenceがあれば読み込む
3. AIMIXでClean Rebuild
4. A/B確認
5. FIX
6. Magic PolishでReferenceまたはSpotify
7. Spatial Auto
8. 必要なclipだけPan Editorで微調整
9. WAV書き出し
```

## 導線整理の方針メモ

現状はAIMIX、Magic Polish、Spatial、Reverb、IR、Pan Editorが同じ目的に見えやすい。
今後は以下のように分けると分かりやすい。

```txt
AIMIX
  目的: stemバランス、Reference追従、FIX

Magic Polish
  目的: 最終音量、Reference LUFS、True Peak、安全Limiter

Spatial
  目的: 左右配置、Clip Pan、奥行き、編集可能な空間レイヤー

Plugin
  目的: 手動の音作り。Reverb / IR / Saturator / EQなど
```

ユーザー向けには、最初の画面で以下の3つだけに絞るのが理想。

```txt
Referenceに近づける
クリーンに再構築する
手動で作り込む
```
