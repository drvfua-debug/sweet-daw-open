# Sweet DAW Mastering Phases 00-02 Report

作業日: 2026-06-18

## Phase 00: Current Structure Audit

### 現在のトップレベルUI

- `DawWorkspace` の上位ビューは `arrange / mix / files` のまま維持されています。
- `Mastering` は上位ビューではなく、右側のAIパネル内の工程タブとして追加されています。
- 右側AIパネルの工程順は `AIMIX -> SPATIAL -> MASTERING` です。

### AIMIXの現在位置

- UI入口: `src/ui/daw/DawWorkspace.tsx`
- 本体: `src/ui/daw/AiMixAssistantPanel.tsx`
- 主要処理:
  - `createProposal`
  - `previewBefore`
  - `previewAfter`
  - `fixProposal`
  - `restoreBefore`
- 状態:
  - `aimixMode`
  - `aimixWorkflowPreset`
  - `proposal`
  - `activeAB`
  - `fixed`

AIMIXは提案、A/B確認、FIXまでを担当します。最終仕上げはMasteringタブのMagic Polishへ誘導する構造です。

### Spatialの現在位置

- UI入口: `src/ui/daw/DawWorkspace.tsx`
- 本体: `src/ui/daw/AimixSpatialPanel.tsx`
- 表示制御: `aiPanelMode === "spatial"`

SpatialはAIMIXとは別タブ扱いで、Pan / Width / Spatial系の調整を担当します。

### Magic Polishの現在位置

- UI本体: `src/ui/daw/AiMixAssistantPanel.tsx`
- 表示条件: `section === "mastering"`
- 既存Magic Polish処理:
  - `analyzeMagicPolish`
  - `applyAimixFinalPolish`
  - `resolveMagicTargetForCurrentProject`
  - `applyFinalPolish`
- 追加済みの1ファイルMastering処理:
  - `src/daw/mastering/singleFileMastering.ts`
  - `analyzeSingleFileMagicPolish`
  - `applySingleFileMagicPolish`
  - `exportSingleFileProcessedWav`

Magic PolishはMasteringタブ内に正式配置されています。AIMIX側には直接実行UIを重複配置していません。

### Exportとの関係

- 通常WAV export入口: `src/ui/daw/DawWorkspace.tsx`
- Offline render: `src/audio/engine/OfflineRenderer.ts`
- WAV encode: `src/audio/export/WavEncoder.ts`

既存の通常exportは `renderProjectOffline` と `encodeWavFromAudioBuffer` を使います。Magic Polishの既存Project反映型処理はmaster設定へ反映され、通常exportにも反映されます。

1ファイルMasteringは、現在のmixを一度レンダーし、そのレンダー済み音声に対して処理して `Export Processed WAV` で別WAVとして書き出します。通常export経路は変更していません。

### 次Phaseで触るべきファイル候補

- `src/ui/daw/DawWorkspace.tsx`
- `src/ui/daw/AiMixAssistantPanel.tsx`
- `src/ui/daw/AimixSpatialPanel.tsx`
- `src/daw/mastering/singleFileMastering.ts`
- `src/audio/engine/OfflineRenderer.ts`
- `src/audio/export/WavEncoder.ts`

## Phase 01: Mastering Tab Shell

### 実装状況

完了済みです。

- `DawWorkspace` に `aiPanelMode: "aimix" | "spatial" | "mastering"` が存在します。
- AIパネルの表示順は `AIMIX / SPATIAL / MASTERING` です。
- `MASTERING` はボタン名が長いため、`AIMIX / SPATIAL` の下に独立ボタンとして配置されています。
- `AiMixAssistantPanel` は `section?: "aimix" | "mastering"` を受け取り、Mastering表示を切り替えます。

### 壊していない範囲

- 上位ビュー `arrange / mix / files` は維持。
- AIMIX提案、A/B、FIXの導線は維持。
- Spatialタブは別表示のまま維持。
- 通常export処理は維持。

## Phase 02: Move Magic Polish To Mastering

### 実装状況

完了済みです。

- Magic Polish UIは `section === "mastering"` の時だけ表示されます。
- AIMIX側には「最終仕上げはMasteringタブで行う」説明のみが残っています。
- 旧AIMIX位置からMagic Polishを直接実行する重複導線はありません。
- 既存Magic PolishのProject反映型処理は再利用されています。

### 既存処理の再利用

- `applyAimixFinalPolish`
- `analyzeMagicPolish`
- `resolveMagicPolishTarget`
- `applyFinalPolish`
- `MagicPolishMode safe / balanced / loud`

### 追加済みの後続機能

Phase 02の後続作業として、Masteringタブ内に1ファイルMastering機能が追加済みです。

- `Existing`
- `Light Master`
- `Loudness Only`
- `Loud Release`

これはMastering内の追加機能であり、AIMIX / Spatial / 通常exportのDSP本体は変更していません。

## 未確認リスク

- 実機iPhone Safariでのタブ切り替え、スクロール、A/B再生は未確認です。
- `gh` はローカル設定ファイル権限の問題でprivate状態をCLI確認できませんでした。
- 1ファイルMasteringのLUFS / True Peakは軽量推定です。厳密な放送規格メーターではありません。

## Phase 00-02 判定

- Phase 00 audit: 完了
- Phase 01 Mastering shell: 完了
- Phase 02 Magic Polish移動: 完了

現在の構成は、添付指示の工程順 `AIMIX -> Spatial -> Mastering -> Export` に沿っています。
