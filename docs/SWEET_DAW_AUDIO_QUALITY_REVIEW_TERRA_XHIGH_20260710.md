# Sweet DAW 音質レビュー / Terra xhigh 実装指示書

作成日: 2026-07-10  
対象ブランチ: `codex/aimix-clip-intelligence`  
調査基準コミット: `150b97a`  
対象: Sweet DAWのみ

## 0. 結論

現状はReference LUFS追従、True Peak保護、Reference除外、AIMIX/Spatial/Mastering、低メモリ書き出しまで広く実装されている。次の改善は新しい音色処理を増やすことではなく、既存処理の動作を揃え、同じ帯域を何度も補正しないことを優先する。

優先順位は以下とする。

1. De-Esserの動作方向とVocal Duckの再生/Export差を修正する
2. Reference Masteringの同種EQ多重実行を、一度決めて一度だけ適用する構造へ整理する
3. iPhone低メモリ書き出しを、通常書き出しと同じ判断・近い聴感にする
4. Saturator等の並列DSPをラウドネス一致させ、音量差を音質差と誤認しないようにする
5. Spatialが実際に効かなかった場合を成功扱いしない

## 1. 調査で確認できた事実

### 1.1 良い状態

- 最新の実STEM 10曲評価では、candidateのLUFSはReference比 `-0.07〜+0.14 LU` に収まっている。
- AIMIX synthetic self-testはPASSしている。
- ReferenceトラックはOffline export対象から除外されている。
- Master gainはLimiter前へ移動済みである。
- 通常のOffline exportには最終sample peak ceilingがある。
- Single File MasteringにはMobile HQ解析と最終True Peak authorityがある。

### 1.2 残っている問題

- 実STEM 10曲すべてにMastering warningが残る。
- Candidate crestはReference比で約 `+1.05〜+2.37 dB` 高い。
- 曲により9〜14kHz GlossがReference比 `+3.28 dB`、14〜20kHz Sheenが `-3.63 dB` など、隣接帯域で逆方向の残差がある。
- `processSingleFileMastering()` はReference Final Tonal Safetyを最大3回、Side High Clampを最大2回実行し得る。
- Reference測定値がある場合、最終Target authorityの解析品質が意図的に`fast`へ落ちる。その後のMobile HQ実測とTarget reportが一致しないケースがある。
- iPhone低メモリ経路は12秒単位で `processSingleFileMastering(... quality: "fast")` を毎回新規実行する。IIR、コンプレッサー、Artifact解析の状態がチャンクごとにリセットされる。
- 低メモリ経路ではAIMIX GlowのVocal sidechainを`null`にし、設定も弱めている。そのため同一設定でもPCとiPhoneで音が変わる。
- Offline Vocal Duckは、実際の歌唱レベルではなくボーカルclipの開始〜終了をduck windowとして使う。無音区間でも伴奏の2.5kHz付近を下げ続ける可能性がある。
- Live Vocal DuckはAnalyserの実レベルを追うため、LiveとExportで挙動が異なる。
- Sweet De-Esserは `dry + (-compressed bandpass)` 構造である。大きい歯擦音ほどcompressor出力が小さくなり、打ち消し量も小さくなる可能性がある。またamount増加時にthresholdが高くなるため、強度の単調性をテストで確認する必要がある。
- 実STEMのSpatial premasterでは、全10曲のSide/Mid変化が `-0.06〜+0.05 dB`、correlation変化は丸め上ほぼ0で、Spatial単体の実効が非常に小さい。
- `audio:golden` はローカル絶対パスの音源が見つからず実行不能。回帰テストの再現性が不足している。

## 2. 絶対条件

- Sweet DAW以外を変更しない。
- 原音、Reference、import assetへ上書きしない。
- Referenceを最終mixへ混ぜない。
- 新規巨大依存、server-side処理、ML、WebGPUを追加しない。
- Safe/Balanced/Dense、AIMIX、Spatial、SWTD/JSON、通常WAV exportを壊さない。
- PreviewとExportで同じparameter resolverを使う。
- iPhone用に音質パラメータを勝手に弱めない。負荷を下げる場合は解析精度・チャンク長・表示更新頻度で調整する。
- 自動処理は必ずgain-matched A/Bを用意する。
- 各Phaseを独立コミット可能な範囲に保つ。
- 各Phase完了時に対象testと`npm run typecheck`を実行する。最後だけ`npm run test`と`npm run build`を実行する。

## 3. Phase 0: Characterization Test

このPhaseでは音を変えない。現在の挙動を数値化し、修正前後を比較できるようにする。

### 3.1 De-Esser単調性テスト

追加候補:

- `src/audio/plugins/deEsserCharacterization.test.ts`
- 必要なら純粋関数を `src/audio/dsp/DeEsserCore.ts` へ抽出

テスト信号:

- 1kHz body + 7.2kHz sibilance
- sibilanceを -36 / -24 / -12 dBFS の3段階
- amount 0.2 / 0.5 / 0.8

期待:

- sibilance入力が大きいほど5〜9kHzのgain reductionが増える
- amountを上げるほどreductionが単調増加する
- 1〜4kHzの損失は0.3dB以内
- bypass差分は-100dBFS以下

現行がこの条件を満たさない場合のみPhase 1でDSPを変更する。

### 3.2 Vocal Duck parityテスト

- 10秒のvocal clip内に、歌唱2秒 / 無音3秒 / 歌唱2秒を作る。
- Live相当level envelopeとOffline scheduled envelopeを比較する。
- 無音区間の2〜5kHz duckは0.15dB未満。
- 歌唱区間だけ設定したmax reductionへ近づく。

### 3.3 Full-buffer / Chunked parityテスト

- 30秒のstereo信号を3秒chunkで処理する。
- Reference Catch-Up、Glow、Glue、Clipper、Limiterを有効にする。
- chunk境界の前後100ms、全曲LUFS、True Peak、主要帯域、Side/Midを比較する。
- 現状値をsnapshotとして保存するが、現状値を合格値にはしない。

### 3.4 Spatial effectivenessテスト

- support stem 4本 + vocal + bass + drumsを用意する。
- Spatial前後のSide/Mid、correlation、mono fold lossを測る。
- 処理量がほぼ0なら「success」ではなく`bypassed_no_effect`と報告するテストを追加する。

### 3.5 Phase 0 実測結果（2026-07-10）

対象test:

```txt
src/audio/plugins/deEsserCharacterization.test.ts
src/audio/fx/DynamicVocalDuck.test.ts
src/daw/aimixSpatial/spatialEffectiveness.test.ts
src/daw/mastering/singleFileMastering.characterization.test.ts
```

結果:

- De-Esser: amount 0.2ではthreshold `-26dB`、amount 0.8では`-20dB`。amountを上げるほどthresholdが上がる現行方向を確認した。
- De-Esser: 現行の並列差分モデルでは、-36dBFS / -24dBFSのsibilanceは約`2.30dB`減るが、-12dBFSでは約`0.68dB`しか減らない。強い歯擦音ほど抑制が弱まる可能性を再現した。
- Vocal Duck: Offline windowは10秒clipに対して`0.00〜10.12秒`を連続duckする。一方、live level detectorは無音時`0dB`、active時`-1.6dB`を要求する。ExportとLiveの差を確認した。
- Chunked Mastering: 30秒 / 48kHz / 3秒chunkで、現行low-memory経路はfull-buffer比 `+0.93LU`、True Peak `+0.94dB`、chunk境界差分`0.283253`だった。Phase 3の受け入れ値（0.15LU / 0.2dB）を満たしていない。
- Spatial: 実STEM測定の`Side/Mid -12.12 -> -12.13dB`、correlation `0.884 -> 0.885`は`bypassed_no_effect`として正しく分類された。

Phase 1の開始条件を満たした。De-Esser V2とVocal activity envelope共有を先に実装し、Chunked MasteringはPhase 3まで現行挙動を変更しない。

## 4. Phase 1: Vocal Clarity Core

### 4.1 Sweet De-Esser V2

対象:

- `src/audio/plugins/PluginChain.ts`
- `src/audio/plugins/pluginRegistry.ts`
- 新規候補 `src/audio/dsp/DeEsserCore.ts`

標準Web Audio Nodeで以下の差分再合成を使う。

```txt
output = dry - bandpass + compressedBandpass
```

ノード案:

```txt
input -> dry -------------------------------> output
input -> sibilance bandpass -> invertGain --> output
                           -> compressor ----> output
```

低レベル時は`-band + band`が相殺されdryを維持し、歯擦音時はcompressedBandが小さくなって該当帯域だけ減る構造にする。

要件:

- 5〜9kHzを中心にする。
- amount増加時はthresholdを下げる、ratioまたはdepthを上げる。現行のようにamount増加でthresholdを上げない。
- gain reduction上限は通常3dB、強設定でも5dB。
- stereo linkを維持する。
- bypass時の位相・音量を変えない。
- 既存project parameterをmigrationなしで読めるようにする。
- 旧実装は互換fallbackとして残してもよいが、新規/自動提案はV2を使う。

### 4.2 Vocal activity envelope共有

対象:

- `src/audio/fx/DynamicVocalDuck.ts`
- `src/audio/engine/AudioEngine.ts`
- `src/audio/engine/OfflineRenderer.ts`
- `src/audio/engine/AudioBufferRegistry.ts`

`buildVocalActivityWindows(project)`のclip全区間判定を、実音量から作る共通envelopeへ置き換える。

型候補:

```ts
type VocalActivityPoint = {
  timeSec: number;
  level: number;
};

type VocalActivityEnvelope = {
  points: VocalActivityPoint[];
  frameMs: number;
  source: "audio-analysis" | "clip-fallback";
};
```

要件:

- 20〜40ms frame、10〜20ms hop。
- sourceStart、timelineStart、clip gain、fadeを反映する。
- lead vocalを優先し、backing vocal weightは0.45〜0.7。
- attack 15〜40ms、release 120〜260ms。
- duck上限は通常1.2dB、最大2dB。
- 無音区間では0dBへ戻す。
- Reference trackはdetector対象外。
- LiveとOfflineは同じenvelope生成ロジックまたは同じcacheを使う。
- buffer未取得時だけclip-fallbackを使い、reportへ明示する。

受け入れ:

- Vocalの子音が前に出るが、伴奏全体が暗くならない。
- 無音区間で2.5kHzが削られ続けない。
- Preview/Exportの2〜5kHz差0.35dB以内。

### 4.3 Phase 1 実装結果（2026-07-10）

- Sweet De-Esserを`dry - bandpass + compressedBandpass`の差分再合成へ変更した。
- amountを上げるとthresholdは下がり、ratioは上がる。Phase 1測定では、-36dBFS / -24dBFS / -12dBFSのsibilanceに対して、抑制は`0.00dB / 0.99dB / 3.41dB`となった。
- Difference pathの深さを内部で制限し、強設定でも理論上の過剰な子音喪失を避ける。
- Sweet Vocal Duck EQのinsert側はneutral routingへ変更した。従来の静的2.5kHzカットとpost-insert dynamic duckの二重処理を解消した。
- Offline exportは、decoded vocal bufferから32ms単位のactivity envelopeを作り、silent spanをduckしない。track gain、clip gain、fade、backing vocal weightを反映する。
- Live playbackも同じaudio-derived envelopeを先にscheduleする。bufferが取得できない場合のみlive detector/fallbackを使う。
- Export warningとAudioEngine debug情報へ、audio-analysis / mixed / clip-fallbackのsourceを出す。
- Phase 1ではReference Master Plan、Target LUFS、Chunked Mastering、Spatial DSPを変更していない。

検証:

```txt
npm run typecheck: PASS
Phase 0/1 targeted Vitest: 7 files / 16 tests PASS
```

## 5. Phase 2: Reference Master Planを一度だけ適用

対象:

- `src/daw/mastering/singleFileMastering.ts`
- 新規候補 `src/daw/mastering/referenceMasterPlan.ts`
- `src/daw/mastering/singleFileMastering.test.ts`

現在の逐次的な再解析・再補正を、次の2段階へ分ける。

```txt
analyze once -> freeze ReferenceMasterPlan -> apply once -> residual safety once
```

型候補:

```ts
type ReferenceMasterPlan = {
  targetGainDb: number;
  subTrimDb: number;
  presenceDb: number;
  clarityDb: number;
  glossDb: number;
  midSheenDb: number;
  sideHighTrimDb: number;
  densityAmount: number;
  maxLimiterGrDb: number;
  reasons: string[];
};
```

処理順:

```txt
Headroom analysis
-> HPF / corrective cleanup
-> Artifact Guard（必要時のみ）
-> frozen tonal plan（1回）
-> density / glue
-> clipper
-> target gain
-> residual tonal safety（各帯域最大0.25dB、1回）
-> true peak ceiling
-> final measurement
```

削減対象:

- `applyReferenceFinalTonalSafetyPass()`を複数回呼ばない。
- `applyReferenceSideHighClamp()`を複数回呼ばない。
- Post-target / Post-catch-up / Post-crestで同じEQを再適用しない。
- Target gain後に残差が出ても、同じbandを往復補正しない。

移動量budget:

- Presence 2〜5kHz: 原則±1.0dB
- Clarity 5〜10kHz: 原則±0.8dB
- Gloss 9〜14kHz: 原則±1.0dB
- 14〜20kHz: false-air/side-high risk時はboost禁止
- residual pass: 各band最大±0.25dB
- 全pass累計をreportへ出す

LUFS:

- Reference測定値がある場合でも最終Target authorityに`fast`を強制しない。
- Full-bufferでは`mobile-hq`のK-weighted/gated値をauthorityとする。
- `targetReport.afterLufs`と最終`after.estimatedLufs`の差を0.2LU以内にする。
- LUFSを合わせるために同じEQやclipperを再度動かさない。

受け入れ:

- 実STEM 10曲でReference比LUFS ±0.5LU。
- Target reportと最終Mobile HQ実測の差0.2LU以内。
- 9〜14kHz過剰と14〜20kHz不足が同時に悪化しない。
- 同じtonal action名が1export内で複数回現れない。

### 5.1 Phase 2 実装結果（2026-07-10）

- `referenceMasterPlan.ts`を追加し、Reference測定値からpresence / focus / air / gloss / sheenの固定プランを作るようにした。
- Reference Clarity / measured correctionsの直後に、固定プランとSide High Clampを各1回だけ適用する。従来のpost-target / post-crest / post-catch-upの再EQは廃止した。
- target authorityはReference測定値があっても`fast`へ落とさず、最終指定quality（通常は`mobile-hq`）を使う。
- 最後の残差補正は、各帯域を最大±0.25dBに制限した`Reference Residual Tonal Safety`として1回だけ実行する。
- `Reference Master Plan`、`Reference Residual Tonal Safety`、`Reference Side High Clamp`が各1回であることを回帰テストで固定した。

検証:

```txt
npm run typecheck: PASS
vitest (referenceMasterPlan / singleFileMastering / characterization): 3 files, 36 tests PASS
```

実音検証（既存stem sum 5組、Referenceとcandidateを同じMobile HQ測定で比較）:

```txt
Reference LUFS差: -0.23〜+0.17 LU
最終target report差: +0.09〜+0.17 LU
Reference Master Plan / Residual Tonal Safety / Side High Clamp: 各曲とも各1回
```

Referenceの簡易RMS近似ではなく、同じMobile HQ測定値をtargetへ渡して比較するよう、`masteringReferenceCatchUpCheck.ts`も更新した。これにより、メーターの近似値と最終処理値を混ぜて判定しない。

未完了:

- 実STEM 10曲のfull-buffer A/B、およびtarget reportと最終Mobile HQ値の実測比較は、Phase 2の実音検証として次に実施する。
- iPhone Chunked Masteringの状態継続とfull-buffer parityはPhase 3で扱う。

## 6. Phase 3: iPhone Chunked Mastering Parity

対象:

- `src/ui/daw/AiMixAssistantPanel.tsx`
- `src/audio/engine/ChunkedOfflineRenderer.ts`
- `src/audio/engine/OfflineRenderer.ts`
- `src/audio/analysis/LoudnessAnalyzer.ts`
- 新規候補 `src/daw/mastering/StreamingMasterProcessor.ts`

### 6.1 全曲PlanとチャンクDSPを分離

現在の各chunkごとの`processSingleFileMastering()`再判断をやめる。

```txt
Pass 1: streaming full-song analysis
Pass 2: frozen planを全chunkへ適用
Pass 3: streaming final report
```

Pass 1は以下を全曲で蓄積する。

- K-weighted gated LUFS
- sample peak / 4x true peak estimate
- LRA / crest / PLR
- 20〜60 / 60〜120 / 250〜500 / 500〜2k / 2〜5k / 5〜10k / 9〜14k / 14〜20k
- Side/Midとcorrelation
- Artifact scoreの全曲統計（最大値だけでなくpercentile）

`rmsDb - 1.2`だけを最終target authorityにしない。

### 6.2 DSP stateをchunk間で維持

優先案:

- Biquad state、compressor envelope、clipper/limiter lookahead、dither RNGをstate objectで次chunkへ渡す。

互換案:

- padded chunkをMastering処理して中央だけencodeする。
- pre-rollは最大release + lookaheadを覆う0.5〜1.0秒。
- 現在のようにrender時にpaddingをcropしてからMasteringへ渡さない。

### 6.3 Phase 3 初期実装結果（2026-07-10）

- `renderProjectSliceOfflinePadded()`を追加し、sliceのpre-roll/post-rollをcropせず返せるようにした。
- iPhone低メモリ書き出しは、0.75秒のpre-rollと0.15秒のpost-rollを含むchunkをMasteringし、中央の本来書き出す区間だけをWAV encoderへ渡す。
- 低メモリ経路でもAIMIX Glowの値を縮小せず、現在のGlow設定を使う。vocal trackがある場合は、同じ時間範囲をchunkごとに追加renderしてGlow sidechainへ渡し、直後に解放する。
- chunk処理も`mobile-hq`測定を使う。従来の`fast`測定固定を廃止した。

初期検証:

```txt
npm run typecheck: PASS
vitest (StreamingMasterProcessor / OfflineRenderer / Mastering): 4 files, 40 tests PASS
npm run aimix:selftest: AIMIX Reference PASS / Spatial Auto PASS
StreamingMasterParity: padded chunkが非padding chunkより境界不連続を増やさないことを確認
StreamingMasterParity: full-bufferとの差はLUFS / True Peakともに0.35dB以内
```

残作業:

- 実機iPhone Safariで5分・12 stemの長尺書き出しを確認する。これはブラウザ実機が必要な最終確認であり、今回のローカル自動検証の対象外。

境界を3sample平滑化するだけで隠さない。連続したDSP stateまたはprocess後cropで解決する。

### 6.3 Glow sidechain

- iPhoneでもvocal sidechainを全曲分保持しない。
- 対応するvocal chunkだけを追加renderし、処理後すぐ解放する。
- PCと同じGlow parameterを使う。
- 負荷制限が必要ならsynthetic air bedだけを無効化し、presence/recover量を勝手に下げない。
- fallback時はUI/reportへ明示する。

受け入れ:

- Full-buffer vs chunked: LUFS差0.15LU以内。
- True Peak差0.2dB以内。
- 主要band差0.35dB以内。
- Side/Mid差0.35dB以内。
- chunk境界前後に単発clickがない。
- 同じ設定でPC/iPhoneの処理planが一致する。
- 5分、12 stem、48kHz stereoでiPhone用推定peak working memory 220MB以下を目標にする。

## 7. Phase 4: Gain-Matched Plugin Contract / Final Peak Truth

対象:

- `src/audio/plugins/PluginChain.ts`
- `src/audio/dsp/PeakMaximizer.ts`
- `src/audio/engine/MasterBus.ts`
- `src/audio/engine/OfflineRenderer.ts`

### 7.1 並列Pluginのgain law

Sweet Saturator、Glow、Air Exciter、Parallel Comp、Widenerをcharacterizationする。

- correlated dry/wetを単純加算して0.5〜1dB音量が上がる状態を避ける。
- 自動提案で挿すpluginは`outputMatch: true`をdefaultにする。
- 既存ユーザーprojectの手動設定はmigrationで勝手に変えない。
- pink noise、vocal-like、drum-like信号でbypass/active RMS差を±0.25dB以内にする。
- SaturatorはDCを増やさず、2〜5kHz/5〜10kHzの過剰を監視する。

### 7.2 Normal Mix WAVのTrue Peak

通常Offline exportはsample peakだけで最終ceilingを判断している。最終判断に既存`estimateTruePeakDbtpFromChannels()`または同等のstreaming 4x推定を使う。

- Hard Limit ON: finalOutputTrim後のTrue Peakがceilingを超える場合だけ全体trim。
- Hard Limit OFF:勝手に音圧を丸めずwarningを出す。ただしPCM範囲外は安全clampする。
- Peak Maximizer有効時も最終reportのTrue Peakと実ファイルを一致させる。
- Preview/Exportのceiling差0.2dB以内。

## 8. Phase 5: Spatial Effectiveness Gate

対象:

- `src/daw/aimixSpatial/spatialPanDesign.ts`
- Spatial適用/検証箇所
- `src/daw/mix/reference/referenceQualityGate.ts`

実STEMではSpatial premasterのSide/Mid変化が最大でも約0.06dBである。これは安全だが、多くのケースで効果がほぼない。

要件:

- Referenceとの差が0.5dB未満ならSpatialをbypassする。
- 差がある場合はGuitar/Keys/Synth/Strings/Other/FXの1.5〜5kHz sideを中心に、小さくReference方向へ動かす。
- Vocal/Bass/Kick/low-dominantはcenter保護。
- 120Hz以下はmono。
- 14〜20kHz Sideが過剰な場合はhigh widening禁止。
- 一回のSpatialでReference gapの25〜60%を埋め、Referenceを0.5dB以上越えない。
- correlationは0.65未満にしない。
- mono fold RMS lossは処理前比0.5dB以内。
- Side/Mid変化が0.1dB未満なら`bypassed_no_effect`と表示する。
- MasteringのImage Catch-UpとSpatialが逆方向に動かないよう、同じtarget snapshotを共有する。

## 9. Golden Testの再現性

対象:

- `scripts/audio/goldenReferenceRegression.ts`
- `test-fixtures/audio/golden/pairs.json`
- `scripts/audio/aimixSelfTest.ts`

現状の`audio:golden`はローカル絶対パス不足で失敗する。音声本体はGitへ追加せず、以下のいずれかにする。

推奨:

```txt
SWEET_DAW_AUDIO_FIXTURE_ROOT=C:\...\stem_wav
```

manifestはfixture rootからの相対パスにする。環境変数がない場合は、どのpairが不足したかを一覧表示して終了する。

Golden判定へ追加:

- Vocal Duck無音区間の2〜5kHz損失
- De-Esser 5〜9kHz reductionと2〜5kHz preservation
- chunk境界click score
- full/chunk parity
- Target report truth
- cumulative EQ move budget
- Spatial effective/bypassed status

## 10. 実音受け入れ

最低でも既存の10組を対象にする。曲名をUIや公開ガイドへ埋め込まない。

各曲で以下を保存する。

```txt
stem sum
AIMIX FIX
Spatial後
Mastering後 full-buffer
Mastering後 chunked
Reference
metrics JSON
actions/warnings JSON
```

評価順:

1. 音量一致A/Bを作る
2. Vocalの子音・歌詞明瞭度を確認
3. 250〜500Hzのこもりを確認
4. 2〜5kHzの距離感を確認
5. 5〜10kHzの刺さりを確認
6. 9〜14kHzの艶と14〜20kHzのノイズ床を分けて確認
7. 低域の芯とmono互換を確認
8. chunk境界、曲頭、曲尾を確認

必須数値:

- Reference使用時LUFS: Reference ±0.5LU
- True Peak:設定ceiling以下（Hard Limit ON時）
- target reportと最終実測: ±0.2LU
- 2〜5kHz: Reference ±1.2dBを目安
- 5〜10kHz: Reference ±1.2dBを目安
- 9〜14kHz: Reference ±1.5dBを目安
- 14〜20kHz:量だけでなくSide/Midを別判定
- correlation: 0.65以上
- mono fold loss:処理前比0.5dB以内

数値passだけで完成扱いにしない。レベルマッチしたReference / Before / Afterを、最低2箇所（密度の高いサビ、低密度区間）で確認する。

## 11. 実装順と停止条件

実装順:

```txt
Phase 0
-> Phase 1 De-Esser
-> Phase 1 Vocal Duck
-> Phase 2 Master Plan
-> 実STEM A/B
-> Phase 3 Chunk parity
-> iPhone実機
-> Phase 4
-> Phase 5
```

停止条件:

- 既存10曲のうち2曲以上で5〜10kHzが1.5dB以上悪化したら停止。
- 既存10曲のうち2曲以上でcrestがReference比+3dBを越えたら停止。
- bypass音が変わったら停止。
- full/chunk差が受け入れ値を越えたら公開用outを生成しない。
- iPhoneで書き出し失敗またはメモリ再読み込みが起きたら公開用outを生成しない。

## 12. Terra xhighへの短い実行プロンプト

```txt
Sweet DAWの音質改善を、docs/SWEET_DAW_AUDIO_QUALITY_REVIEW_TERRA_XHIGH_20260710.mdに従って実装してください。

今回はPhase 0だけを実行してください。現行音を変更せず、De-Esser単調性、Vocal Duck live/export parity、full-buffer/chunked parity、Spatial effectivenessのcharacterization testを追加してください。

重要:
- Sweet DAW以外を変更しない
- 原音/Referenceへ上書きしない
- 新規巨大依存を追加しない
- 既存未コミット変更を戻さない
- テストで現状の問題を再現してから次Phaseへ進む
- npm run typecheckと対象testを実行する
- Phase 1以降へ進まず、測定結果・変更ファイル・次の推奨だけを報告する
```
