import type { CharacterPluginMode, CharacterPluginState, Project, Track, EQBand, ParametricEQState, CompressorState, StemRole } from "@/daw/model/Project";
import { sanitizeParametricEQState } from "../../audio/fx/ParametricEQ";
import { applyPeakingToSlot, applyShelfGainToSlot } from "./eqSlotUtils";
import { applyEQPresetWithAmount, getEQPresetForRole } from "../../audio/presets/eqPresets";
import { MAGIC_POLISH_MODE_SETTINGS, type MagicPolishMode, type MagicPolishModeSettings, type MixStrength, type PresetId, type LoudnessTarget, type MagicPolishGenre, getStrengthFactor, getBaseRoleGain, getBaseRolePan } from "./aiMixPresets";
import type { AiMixSnapshot } from "@/daw/store/dawStore";
import type { ReferenceDelta } from "./mixDoctorTypes";

export type MagicPolishAnalysis = {
  lowEnergy?: number;
  lowMidEnergy?: number;
  presenceEnergy?: number;
  airEnergy?: number;
  ultraAirEnergy?: number;
  topAirEnergy?: number;
  crestFactorDb?: number;
  stereoWidth?: number;
};

export type AiMixWorkflow = "one-click" | "doctor-touchup";

export type AiMixComputeOptions = {
  workflow?: AiMixWorkflow;
  referenceDelta?: ReferenceDelta | null;
  referenceCrestFactorDb?: number | null;
  referenceCrestFollow?: boolean;
  allowReferenceProcessing?: boolean;
};

const DEFAULT_MAGIC_POLISH_ANALYSIS: Required<MagicPolishAnalysis> = {
  lowEnergy: 0.45,
  lowMidEnergy: 0.45,
  presenceEnergy: 0.45,
  airEnergy: 0.45,
  ultraAirEnergy: 0.35,
  topAirEnergy: 0.25,
  crestFactorDb: 9,
  stereoWidth: 0.22,
};

// 自動ミキシング適用前のスナップショットを作成する
export function createAiMixSnapshot(project: Project): AiMixSnapshot {
  return {
    tracks: project.tracks.map((track) => ({
      id: track.id,
      gainDb: track.gainDb,
      pan: track.pan,
      role: track.role,
      eq: JSON.parse(JSON.stringify(track.eq)),
      compressor: JSON.parse(JSON.stringify(track.compressor)),
      character: JSON.parse(JSON.stringify(track.character)),
    })),
    master: {
      gainDb: project.master.gainDb,
      mixBusTrimDb: project.master.mixBusTrimDb,
      eq: JSON.parse(JSON.stringify(project.master.eq)),
      compressor: JSON.parse(JSON.stringify(project.master.compressor)),
      limiterEnabled: project.master.limiterEnabled,
      target: JSON.parse(JSON.stringify(project.master.target)),
    },
  };
}

// プリセット適用後の新しいトラックおよびマスター状態を計算してストアに反映させるための関数
export function computeAiMix(
  project: Project,
  presetId: PresetId,
  strength: MixStrength,
  loudnessTarget: LoudnessTarget,
  magicGenre: MagicPolishGenre,
  magicMode: MagicPolishMode = "balanced",
  analysis: MagicPolishAnalysis = {},
  options: AiMixComputeOptions = {},
): { tracks: Track[]; master: Project["master"] } {
  const workflow = options.workflow ?? "one-click";
  const doctorTouchup = workflow === "doctor-touchup" && presetId === "magic-pro-polish";
  const effectiveMagicMode = doctorTouchup && magicMode === "loud" ? "balanced" : magicMode;
  const S = doctorTouchup ? Math.min(getStrengthFactor(strength), 0.35) : getStrengthFactor(strength);
  const polish = MAGIC_POLISH_MODE_SETTINGS[effectiveMagicMode] ?? MAGIC_POLISH_MODE_SETTINGS.balanced;
  const polishAnalysis = { ...DEFAULT_MAGIC_POLISH_ANALYSIS, ...analysis };
  const referenceDelta = options.referenceDelta ?? null;
  const harshnessGuard = getHarshnessGuard(polishAnalysis);
  const toneS = S * polish.toneScale;
  const airS = S * polish.airScale * harshnessGuard.airScale;
  const widthS = S * polish.widthScale;
  const updatedTracks = project.tracks.map((track, index) => {
    if (track.role === "reference" || track.type === "reference") {
      return track;
    }

    // 1. 各トラックの基本 Gain & Pan バランス
    const baseGain = getBaseRoleGain(track.role);
    const basePan = getBaseRolePan(track.role, index);

    // 強度（Strength）に応じて元の設定（通常は 0dB/Pan センター想定ですが、既存値がある場合はそれとのブレンド）
    // AI が提案する値を S で調整。S=1.0 なら 100% 適用、S=0.35 なら一部のみ適用
    const targetGain = doctorTouchup
      ? getDoctorTouchupGain(track.role, track.gainDb, S)
      : getStemAwareTargetGain(track.role, track.gainDb, baseGain, S, presetId, polishAnalysis);
    const targetPan = doctorTouchup ? track.pan : getStemAwareTargetPan(track.role, track.pan, basePan, S, presetId);

    // ディープコピーして部分更新
    const nextEq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
    const nextComp: CompressorState = JSON.parse(JSON.stringify(track.compressor));
    const nextCharacter: CharacterPluginState = JSON.parse(JSON.stringify(track.character));

    // 各プリセットごとの EQ, Compressor の自動調整
    switch (presetId) {
      case "magic-pro-polish":
        // ✨ Magic Pro Polish: 楽曲のジャンルに合わせてEQ/コンプ処理を劇的に変える
        nextEq.enabled = true;
        
        const applyLegacyMagicGenreEq = false;
        if (applyLegacyMagicGenreEq && magicGenre === "pop") {
          // J-POP/POPS: ボーカルの艶・エアーと明瞭度を最大化し、オケの干渉を徹底カット
          if (track.role === "vocal" || track.role === "backingVocal") {
            applyHighpass(nextEq, 100);
            applyPeaking(nextEq, 3500, 2.0 * S, 1.0); // プレゼンス
            applyPeaking(nextEq, 10000, 1.5 * S, 0.8); // エアー艶
            nextComp.enabled = true;
            nextComp.threshold = -15;
            nextComp.ratio = 2.5;
            nextComp.attack = 0.010;
            nextComp.release = 0.120;
          } else if (track.role === "drums" || track.role === "bass") {
            applyHighpass(nextEq, track.role === "bass" ? 30 : 35);
            applyPeaking(nextEq, 250, -2.0 * S, 0.9); // 濁りカット
          } else {
            // オケのボーカル被りをカットしてスペースを確保
            applyHighpass(nextEq, 100);
            applyPeaking(nextEq, 2500, -1.8 * S, 0.8); // ボーカル被り帯域を削る
            applyPeaking(nextEq, 8000, 1.2 * S, 0.8);
          }
        } 
        else if (applyLegacyMagicGenreEq && magicGenre === "rock") {
          // ROCK: ギターのミドルエッジ、ドラムの重量感と重量コンプ、ボーカルの突き抜け感を重視
          if (track.role === "vocal") {
            applyHighpass(nextEq, 120);
            applyPeaking(nextEq, 2500, 1.8 * S, 1.1); // オケに埋もれないエッジ
            applyPeaking(nextEq, 8000, 0.35 * S, 0.9);
            nextComp.enabled = true;
            nextComp.threshold = -14;
            nextComp.ratio = 3.0;
          } else if (track.role === "drums") {
            applyHighpass(nextEq, 28);
            applyPeaking(nextEq, 80, 0.15 * S, 1.2); // キックのパンチ
            applyPeaking(nextEq, 1500, 2.0 * S, 1.0); // スネアの抜け
            nextComp.enabled = true;
            nextComp.threshold = -18;
            nextComp.ratio = 4.0; // ドラムを強力に叩く
            nextComp.attack = 0.030;
            nextComp.release = 0.180;
          } else if (track.role === "bass") {
            applyHighpass(nextEq, 28);
            applyPeaking(nextEq, 65, 0.1 * S, 1.0);
            applyPeaking(nextEq, 150, -1.5 * S, 1.0);
            nextComp.enabled = true;
            nextComp.threshold = -15;
            nextComp.ratio = 3.5;
          } else if (track.role === "guitar") {
            applyHighpass(nextEq, 80);
            applyPeaking(nextEq, 2000, 1.5 * S, 1.0); // エレキギターの存在感
          }
        } 
        else if (applyLegacyMagicGenreEq && magicGenre === "club") {
          // CLUB/DANCE: 重低音(サブベース)とタイトなキック、シンセの煌びやかさとPan大拡張
          if (track.role === "drums") {
            applyHighpass(nextEq, 35);
            applyPeaking(nextEq, 60, 0.1 * S, 1.2); // キックの重低音プッシュ
            nextComp.enabled = true;
            nextComp.threshold = -16;
            nextComp.ratio = 3.5;
            nextComp.attack = 0.025;
            nextComp.release = 0.150;
          } else if (track.role === "bass") {
            applyHighpass(nextEq, 25);
            applyPeaking(nextEq, 50, 0 * S, 1.1); // サブベース
            applyPeaking(nextEq, 150, -2.0 * S, 1.0); // 濁りを抜き超低域を際立たせる
            nextComp.enabled = true;
            nextComp.threshold = -16;
            nextComp.ratio = 3.0;
          } else if (track.role === "synth" || track.role === "fx") {
            applyHighpass(nextEq, 120);
            applyPeaking(nextEq, 8000, 0.35 * S, 0.8); // 煌びやかなエアー
          }
        } 
        else if (applyLegacyMagicGenreEq && magicGenre === "acoustic") {
          // ACOUSTIC/JAZZ: 極めてナチュラル。トランジェントを保ち、豊かな温かみ(100Hz〜250Hz)を引き上げる
          nextComp.enabled = true;
          nextComp.ratio = 1.8; // コンプは非常に緩やか
          nextComp.threshold = -12;
          
          if (track.role === "vocal") {
            applyHighpass(nextEq, 80);
            applyPeaking(nextEq, 12000, 1.2 * S, 0.7); // エアーのナチュラルな透明感
          } else if (track.role === "bass") {
            applyHighpass(nextEq, 35);
            applyPeaking(nextEq, 120, 0.1 * S, 1.0); // ウッドベースの温かみ
          } else {
            applyHighpass(nextEq, 100);
            applyPeaking(nextEq, 150, 0.1 * S, 0.8); // 温かみ
          }
        }
        applyMagicProRoleEnhancement(nextEq, nextComp, nextCharacter, track.role, magicGenre, S, polish, polishAnalysis);
        break;

      case "clean-stem-mix":
        // EQ / Comp はほとんど無効化またはフラット
        nextEq.enabled = false;
        nextComp.enabled = false;
        break;

      case "vocal-forward":
        if (track.role === "vocal") {
          // ボーカルをやや前に、ローカットとプレゼンス域ブースト
          nextEq.enabled = true;
          applyHighpass(nextEq, 100); // 100Hz ローカット
          applyPeaking(nextEq, 3500, 1.5 * S, 1.0); // プレゼンス
          applyPeaking(nextEq, 7500, 1.0 * S, 1.0); // プレゼンス
          // 軽いコンプレッション
          nextComp.enabled = true;
          nextComp.threshold = -16;
          nextComp.ratio = 2.5;
          nextComp.attack = 0.015;
          nextComp.release = 0.15;
        } else if (track.role === "music" || track.role === "synth" || track.role === "keys" || track.role === "guitar") {
          // オケのボーカル帯域を軽くEQダッキングしてスペース確保
          nextEq.enabled = true;
          applyPeaking(nextEq, 2500, -2.0 * S, 0.8); // 2.5kHz 付近をダッキング
        }
        break;

      case "dark-pop-open":
        // 中音域（濁り）をカット、高音域をクリアにブースト
        nextEq.enabled = true;
        applyHighpass(nextEq, track.role === "bass" || track.role === "drums" ? 30 : 120);
        applyPeaking(nextEq, 250, -1.5 * S, 1.0); // 250Hz 付近カット
        applyPeaking(nextEq, 8000, 1.5 * S, 0.7); // 8kHz ハイシェルフ/ピークブースト
        break;

      case "club-tight":
        if (track.role === "bass") {
          nextEq.enabled = true;
          applyHighpass(nextEq, 30);
          applyPeaking(nextEq, 60, 2.0 * S, 1.2); // サブ低音プッシュ
          applyPeaking(nextEq, 250, -2.0 * S, 1.0); // 250Hz カットで濁りをとる
          nextComp.enabled = true;
          nextComp.threshold = -18;
          nextComp.ratio = 3.0;
        } else if (track.role === "drums") {
          nextEq.enabled = true;
          applyHighpass(nextEq, 35);
          applyPeaking(nextEq, 80, 1.5 * S, 1.0); // キックのパンチ
          nextComp.enabled = true;
          nextComp.threshold = -20;
          nextComp.ratio = 4.0;
        }
        break;

      case "hook-style-wide-lift":
        // 左右の Pan 配置を広げてステレオの立体感を強調
        break;
    }

    return {
      ...track,
      gainDb: parseFloat(targetGain.toFixed(1)),
      pan: parseFloat(targetPan.toFixed(2)),
      eq: sanitizeParametricEQState(nextEq),
      compressor: nextComp,
      character: nextCharacter,
    };
  });

  // 2. マスターバスの設定 (マスタリング・ターゲット別音圧最適化)
  const nextMaster = JSON.parse(JSON.stringify(project.master));
  nextMaster.limiterEnabled = true; // 安全のためリミッターは常時ON

  // A. マスタリングLoudness音圧ターゲット別のゲイン・コンプ処理
  if (presetId !== "magic-pro-polish") {
    switch (loudnessTarget) {
    case "spotify":
      // Spotify: -14 LUFS ターゲット向けの適度なゲインプッシュとマスターコンプ
      nextMaster.gainDb = parseFloat((1.2 * S).toFixed(1));
      nextMaster.compressor.enabled = true;
      nextMaster.compressor.threshold = -15;
      nextMaster.compressor.ratio = 1.8;
      nextMaster.compressor.attack = 0.020;
      nextMaster.compressor.release = 0.150;
      break;
    case "apple-music":
      // Apple Music: -16 LUFS ターゲット向けのクリーンかつダイナミックな設定
      nextMaster.gainDb = parseFloat((0.8 * S).toFixed(1));
      nextMaster.compressor.enabled = true;
      nextMaster.compressor.threshold = -16;
      nextMaster.compressor.ratio = 1.6;
      nextMaster.compressor.attack = 0.030;
      nextMaster.compressor.release = 0.200;
      break;
    case "soundcloud":
      // SoundCloud: -9 LUFS ターゲット向けの強力な音圧プッシュ
      nextMaster.gainDb = parseFloat((2.5 * S).toFixed(1));
      nextMaster.compressor.enabled = true;
      nextMaster.compressor.threshold = -18;
      nextMaster.compressor.ratio = 2.2;
      nextMaster.compressor.attack = 0.015;
      nextMaster.compressor.release = 0.120;
      break;
    case "none":
    default:
      nextMaster.gainDb = 0.0;
      nextMaster.compressor.enabled = false;
      break;
    }
  }
 
  // B. Magic Pro Polish の専用マスタリングEQおよびマスターコンプブレンド（追加ゲイン含む）
  if (presetId === "magic-pro-polish") {
    const limiterPushDb = getLimiterPushForCrestFollow(
      polish.limiterPushDb,
      polishAnalysis.crestFactorDb,
      options.referenceCrestFactorDb,
      effectiveMagicMode,
      options.referenceCrestFollow ?? true,
    );
    const maxMasterPush = effectiveMagicMode === "safe" ? 0.12 : effectiveMagicMode === "loud" ? 0.55 : 0.28;
    nextMaster.gainDb = parseFloat(Math.min(nextMaster.gainDb + limiterPushDb * S, maxMasterPush).toFixed(1));
    nextMaster.eq = applyEQPresetWithAmount(nextMaster.eq, getEQPresetForRole("master"), getMagicMasterEqAmount(S, polish));
    applyHighpass(nextMaster.eq, magicGenre === "club" ? 28 : 25);
    
    if (magicGenre === "pop") {
      applyPeaking(nextMaster.eq, 300, -0.18 * toneS, 0.8);
      applyPeaking(nextMaster.eq, 1800, clampDb(0.08 * toneS, 0.12), 0.9);
      applyPeaking(nextMaster.eq, 4200, clampDb(0.1 * toneS, 0.15), 1.0);
      applyPeaking(nextMaster.eq, 9500, clampDb(0.08 * airS, 0.12), 0.8);
      applyHighShelf(nextMaster.eq, 12500, clampDb(0.04 * airS, 0.08), 0.7);
    } else if (magicGenre === "rock") {
      applyPeaking(nextMaster.eq, 250, -0.22 * toneS, 0.8);
      applyPeaking(nextMaster.eq, 2600, clampDb(0.12 * toneS, 0.18), 0.9);
      applyPeaking(nextMaster.eq, 4300, clampDb(0.08 * toneS, 0.12), 1.0);
      applyPeaking(nextMaster.eq, 10000, clampDb(0.08 * airS, 0.12), 0.8);
    } else if (magicGenre === "club") {
      applyPeaking(nextMaster.eq, 260, -0.22 * toneS, 0.8);
      applyPeaking(nextMaster.eq, 95, 0, 1.0);
      applyHighShelf(nextMaster.eq, 12000, clampDb(0.05 * airS, 0.08), 0.7);
    } else if (magicGenre === "acoustic") {
      applyPeaking(nextMaster.eq, 300, -0.12 * toneS, 0.8);
      applyHighShelf(nextMaster.eq, 12000, clampDb(0.04 * airS, 0.08), 0.7);
    }

    applyReferenceDeltaToMasterEq(nextMaster.eq, referenceDelta, S, effectiveMagicMode, magicGenre, polishAnalysis, harshnessGuard);

    // プロのまとまり感を出すマスターコンプの上書きまたはブレンド
    nextMaster.compressor.enabled = true;
    nextMaster.compressor.threshold = effectiveMagicMode === "safe" ? -9 : effectiveMagicMode === "loud" ? -13 : -10.5;
    nextMaster.compressor.ratio = effectiveMagicMode === "safe" ? 1.08 : effectiveMagicMode === "loud" ? 1.35 : 1.16;
    nextMaster.compressor.attack = effectiveMagicMode === "loud" ? 0.028 : 0.045;
    nextMaster.compressor.release = effectiveMagicMode === "safe" || magicGenre === "acoustic" ? 0.24 : 0.2;
    nextMaster.compressor.knee = 14;
    nextMaster.compressor.makeupGainDb = parseFloat(((effectiveMagicMode === "loud" ? 0.08 : effectiveMagicMode === "safe" ? 0 : 0.03) * S).toFixed(1));
  }

  // Hook-Style Wide Lift および Magic Pro Polish の場合は、Pan をさらに外側に押し広げてステレオ感を劇的に強化
  if (presetId === "hook-style-wide-lift" || (presetId === "magic-pro-polish" && !doctorTouchup)) {
    const panMultiplier = presetId === "magic-pro-polish" ? 1.0 + 0.12 * widthS : 1.3;
    updatedTracks.forEach((track) => {
      if (track.role === "vocal" || track.role === "drums" || track.role === "bass") {
        track.pan = 0;
        return;
      }

      if (presetId === "magic-pro-polish") {
        const canWiden = track.role === "guitar" || track.role === "synth" || track.role === "keys" || track.role === "music" || track.role === "loop" || track.role === "fx" || track.role === "other";
        track.pan = canWiden
          ? parseFloat(Math.max(-0.55, Math.min(0.55, track.pan * panMultiplier)).toFixed(2))
          : track.pan;
        track.eq.enabled = true;
        applyHighSideWidthPolish(track.eq, track.role, airS);
      } else {
        track.pan = parseFloat((track.pan * (1.0 + (panMultiplier - 1.0) * S)).toFixed(2));
        track.eq.enabled = true;
        applyPeaking(track.eq, 3000, 1.2 * S, 0.9);
      }
    });
  }

  if (doctorTouchup) {
    return {
      tracks: updatedTracks,
      master: project.master,
    };
  }

  return {
    tracks: updatedTracks,
    master: {
      ...nextMaster,
      eq: sanitizeParametricEQState(nextMaster.eq),
    },
  };
}

// EQ 帯域を設定するヘルパー関数
function getMagicMasterEqAmount(strength: number, polish: MagicPolishModeSettings) {
  const modeBase = polish.mode === "safe" ? 0.32 : polish.mode === "loud" ? 0.58 : 0.45;
  return clamp01(modeBase + strength * 0.18);
}

function getLimiterPushForCrestFollow(
  basePushDb: number,
  currentCrestDb: number,
  referenceCrestDb: number | null | undefined,
  mode: MagicPolishMode,
  enabled: boolean,
) {
  const crestTooLow = currentCrestDb < 7 && mode !== "loud";
  let nextPush = crestTooLow ? basePushDb * 0.45 : basePushDb;
  const hasReference = enabled && typeof referenceCrestDb === "number" && Number.isFinite(referenceCrestDb);
  if (!hasReference) return nextPush;

  const crestDeltaDb = currentCrestDb - referenceCrestDb;
  const sensitivity = mode === "safe" ? 0.08 : mode === "loud" ? 0.14 : 0.11;
  const adjustmentDb = clamp(crestDeltaDb * sensitivity, mode === "safe" ? -0.14 : -0.28, mode === "loud" ? 0.32 : 0.24);
  const minPush = mode === "safe" ? 0.02 : mode === "loud" ? 0.16 : 0.08;
  const maxPush = mode === "safe" ? 0.18 : mode === "loud" ? 0.62 : 0.42;

  if (currentCrestDb < referenceCrestDb - 1.5 && mode !== "loud") {
    nextPush = Math.min(nextPush, basePushDb * 0.55);
  }

  return clamp(nextPush + adjustmentDb, minPush, maxPush);
}

function applyReferenceDeltaToMasterEq(
  eq: ParametricEQState,
  referenceDelta: ReferenceDelta | null,
  strength: number,
  mode: MagicPolishMode,
  genre: MagicPolishGenre,
  analysis: Required<MagicPolishAnalysis>,
  guard: ReturnType<typeof getHarshnessGuard>,
) {
  if (!referenceDelta) return;

  const modeScale = mode === "safe" ? 0.32 : mode === "loud" ? 0.58 : 0.46;
  const feedbackScale = strength * modeScale;
  const lowBoostBlocked = analysis.lowEnergy >= 0.5;
  const airCap = mode === "loud" ? 0.85 : mode === "safe" ? 0.35 : 0.6;
  const presenceCap = mode === "loud" ? 1.0 : mode === "safe" ? 0.45 : 0.75;
  const lowCap = mode === "loud" ? 0.45 : mode === "safe" ? 0.2 : 0.35;

  if (Math.abs(referenceDelta.airDeltaDb) > 0.5) {
    const airMove = referenceDelta.airDeltaDb * feedbackScale * guard.airScale;
    const maxAirCutDb = referenceDelta.airDeltaDb > 0 ? 0 : 0.18;
    applyHighShelf(eq, 12000, clampSignedDb(airMove, airCap, maxAirCutDb), 0.7);
  }

  if (Math.abs(referenceDelta.presenceDeltaDb) > 0.5) {
    const presenceMove = referenceDelta.presenceDeltaDb * feedbackScale;
    applyPeaking(eq, 3500, clampSignedDb(presenceMove, presenceCap, 1.4), 1.0);
  }

  if (Math.abs(referenceDelta.bodyDeltaDb) > 0.5) {
    const bodyMove = referenceDelta.bodyDeltaDb * feedbackScale;
    applyPeaking(eq, 300, clampSignedDb(bodyMove, 0.8, 1.4), 0.8);
  }

  if (Math.abs(referenceDelta.lowEndDeltaDb) > 0.5) {
    applyHighpass(eq, genre === "club" ? 28 : 25);
    const lowDelta = referenceDelta.lowEndDeltaDb > 0
      ? (lowBoostBlocked ? 0 : referenceDelta.lowEndDeltaDb * 0.22)
      : referenceDelta.lowEndDeltaDb * 0.55;
    applyPeaking(eq, 80, clampSignedDb(lowDelta * feedbackScale, lowCap, 1.5), 1.0);
  }
}

function applySharedMagicEqPolicy(
  eq: ParametricEQState,
  role: StemRole,
  strength: number,
  polish: MagicPolishModeSettings,
  guard: ReturnType<typeof getHarshnessGuard>,
) {
  const preset = getEQPresetForRole(role);
  const amount = getMagicRoleEqAmount(role, strength, polish);
  const nextEq = applyEQPresetWithAmount(eq, preset, amount);
  const guardedEq = reducePositiveAirBoost(nextEq, guard.airScale);
  Object.assign(eq, guardedEq);
}

function getMagicRoleEqAmount(role: StemRole, strength: number, polish: MagicPolishModeSettings) {
  const modeBase = polish.mode === "safe" ? 0.28 : polish.mode === "loud" ? 0.52 : 0.38;
  const roleScale =
    role === "vocal" ? 0.82 :
    role === "backingVocal" ? 0.68 :
    role === "drums" ? 0.58 :
    role === "bass" ? 0.55 :
    role === "guitar" ? 0.78 :
    role === "synth" || role === "keys" || role === "music" || role === "loop" ? 0.74 :
    role === "fx" ? 0.62 :
    0.68;
  return clamp01((modeBase + strength * 0.25) * roleScale);
}

function reducePositiveAirBoost(eq: ParametricEQState, airScale: number): ParametricEQState {
  if (airScale >= 0.98) return eq;

  return {
    ...eq,
    bands: eq.bands.map((band) => {
      const highBand = band.frequency >= 8000 || band.type === "highshelf";
      if (!highBand || band.gainDb <= 0) return band;
      return {
        ...band,
        gainDb: parseFloat((band.gainDb * airScale).toFixed(1)),
      };
    }),
  };
}

function applyHighSideWidthPolish(eq: ParametricEQState, role: StemRole, airStrength: number) {
  if (role === "guitar") return;

  const boost =
    role === "fx" ? clampDb(0.08 * airStrength, 0.12) :
    role === "backingVocal" ? clampDb(0.05 * airStrength, 0.08) :
    role === "synth" || role === "keys" || role === "music" || role === "loop" || role === "other" ? clampDb(0.04 * airStrength, 0.08) :
    0;

  if (boost <= 0) return;
  applyHighShelf(eq, role === "fx" ? 9000 : 10500, boost, 0.8);
}

function getDoctorTouchupGain(role: StemRole, currentGainDb: number, strength: number) {
  const trim =
    role === "vocal" ? 0.12 :
    role === "backingVocal" ? -0.12 :
    role === "fx" ? -0.18 :
    role === "synth" || role === "keys" || role === "guitar" || role === "music" || role === "loop" ? -0.08 :
    0;
  return currentGainDb + trim * strength;
}

function getStemAwareTargetGain(
  role: StemRole,
  currentGainDb: number,
  baseGain: number,
  strength: number,
  presetId: PresetId,
  analysis: Required<MagicPolishAnalysis>,
) {
  if (presetId !== "magic-pro-polish") {
    return Math.max(-30, Math.min(12, currentGainDb + (baseGain - currentGainDb) * strength));
  }

  const lowHeavy = analysis.lowEnergy > 0.52;
  const lowMidHeavy = analysis.lowMidEnergy > 0.56;
  const trim =
    role === "vocal" ? 0.45 :
    role === "backingVocal" ? -0.75 :
    role === "drums" ? (lowHeavy ? -0.9 : -0.45) :
    role === "bass" ? (lowHeavy ? -1.2 : -0.65) :
    role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop" ? (lowMidHeavy ? -0.45 : -0.2) :
    role === "fx" ? -1.2 :
    0;

  return Math.max(-18, Math.min(6, currentGainDb + trim * strength));
}

function getStemAwareTargetPan(role: StemRole, currentPan: number, basePan: number, strength: number, presetId: PresetId) {
  if (presetId !== "magic-pro-polish") {
    return Math.max(-1, Math.min(1, currentPan + (basePan - currentPan) * strength));
  }

  if (role === "vocal" || role === "drums" || role === "bass" || role === "reference") {
    const centerLimit =
      role === "vocal" ? 0.04 :
      role === "bass" ? 0.03 :
      role === "drums" ? 0.06 :
      0;
    const centered = currentPan + (0 - currentPan) * Math.min(1, 0.4 + strength * 0.6);
    return Math.max(-centerLimit, Math.min(centerLimit, centered));
  }

  const placement =
    role === "backingVocal" ? 1.05 :
    role === "fx" ? 1.15 :
    role === "synth" || role === "keys" || role === "guitar" ? 0.95 :
    0.75;
  const targetPan = Math.max(-0.55, Math.min(0.55, basePan * Math.min(1, 0.65 + strength * 0.35) * placement));
  return Math.max(-0.55, Math.min(0.55, currentPan + (targetPan - currentPan) * Math.min(1, 0.45 + strength * 0.45)));
}

function applyHighpass(eq: ParametricEQState, cutoffHz: number) {
  const hpBand = eq.bands.find((b) => b.type === "highpass");
  if (hpBand) {
    hpBand.enabled = true;
    hpBand.frequency = cutoffHz;
  }
}

function applyPeaking(eq: ParametricEQState, freqHz: number, gainDb: number, q: number) {
  applyPeakingToSlot(eq, "role_enhancement", `role_${Math.round(freqHz)}`, freqHz, gainDb, q);
}

function applyHighShelf(eq: ParametricEQState, freqHz: number, gainDb: number, q: number) {
  applyShelfGainToSlot(eq, "highshelf", "shared_magic_policy", `high_shelf_${Math.round(freqHz)}`, freqHz, gainDb, q);
}

function getHarshnessGuard(analysis: Required<MagicPolishAnalysis>) {
  const highIsStrong = analysis.airEnergy >= 0.68 || analysis.ultraAirEnergy >= 0.6;
  const ultraIsStrong = analysis.ultraAirEnergy >= 0.55 || analysis.topAirEnergy >= 0.5;
  let airScale = 1;

  if (highIsStrong) airScale *= 0.58;
  if (ultraIsStrong) airScale *= 0.72;

  return {
    highIsStrong,
    ultraIsStrong,
    airScale: Math.max(0.28, Math.min(1, airScale)),
  };
}

function clampDb(value: number, maxBoostDb: number) {
  return parseFloat(Math.max(-18, Math.min(maxBoostDb, value)).toFixed(1));
}

function clampSignedDb(value: number, maxBoostDb: number, maxCutDb = maxBoostDb) {
  return parseFloat(Math.max(-maxCutDb, Math.min(maxBoostDb, value)).toFixed(1));
}

function applyMagicProRoleEnhancement(
  eq: ParametricEQState,
  compressor: CompressorState,
  character: CharacterPluginState,
  role: StemRole,
  genre: MagicPolishGenre,
  strength: number,
  polish: MagicPolishModeSettings,
  analysis: Required<MagicPolishAnalysis>,
) {
  eq.enabled = true;
  const guard = getHarshnessGuard(analysis);
  const tone = strength * polish.toneScale;
  const isLoud = polish.mode === "loud";
  const isSafe = polish.mode === "safe";
  applySharedMagicEqPolicy(eq, role, strength, polish, guard);

  if (role === "vocal" || role === "backingVocal") {
    const isLeadVocal = role === "vocal";
    if (!isLeadVocal) applyHighpass(eq, 120);
    if (guard.highIsStrong) applyPeaking(eq, 6800, -0.45 * tone, 2.4);

    if (isLeadVocal) {
      character.enabled = false;
      compressor.enabled = false;
    } else {
      character.enabled = false;
      applyPeaking(eq, 3200, -0.12 * tone, 1.0);
      compressor.enabled = !isSafe;
      compressor.threshold = isLoud ? -15 : -12.5;
      compressor.ratio = isLoud ? 1.7 : 1.35;
      compressor.attack = 0.026;
      compressor.release = 0.18;
      compressor.knee = 12;
      compressor.makeupGainDb = 0;
    }
    return;
  }

  if (role === "drums") {
    character.enabled = false;
    applyHighpass(eq, 30);
    applyPeaking(eq, 220, -0.45 * tone, 1.0);
    compressor.enabled = !isSafe;
    compressor.threshold = isLoud ? -17 : -14.5;
    compressor.ratio = isLoud ? 2.2 : 1.45;
    compressor.attack = 0.024;
    compressor.release = 0.18;
    compressor.knee = 12;
    compressor.makeupGainDb = 0;
    return;
  }

  if (role === "bass") {
    applyCharacter(character, "bassTight", 0.09 + 0.04 * tone, 0.38, 0.06 + 0.03 * tone);
    applyHighpass(eq, 30);
    applyPeaking(eq, 180, -0.55 * tone, 1.05);
    applyPeaking(eq, 900, 0.28 * tone, 1.0);
    compressor.enabled = !isSafe;
    compressor.threshold = isLoud ? -16 : -13.5;
    compressor.ratio = isLoud ? 2.0 : 1.4;
    compressor.attack = 0.028;
    compressor.release = 0.18;
    compressor.knee = 12;
    compressor.makeupGainDb = 0;
    return;
  }

  if (role === "guitar") {
    character.enabled = false;
    applyHighpass(eq, 85);
    compressor.enabled = isLoud;
    compressor.threshold = -13;
    compressor.ratio = 1.35;
    compressor.attack = 0.018;
    compressor.release = 0.16;
    return;
  }

  if (role === "synth" || role === "keys" || role === "music" || role === "loop") {
    character.enabled = false;
    if (role === "music") applyHighpass(eq, 35);
    compressor.enabled = false;
    compressor.threshold = -12;
    compressor.ratio = 1.2;
    compressor.attack = 0.022;
    compressor.release = 0.18;
    return;
  }

  if (role === "fx") {
    character.enabled = false;
    applyHighpass(eq, 150);
    return;
  }

  character.enabled = false;
  applyHighpass(eq, 80);
}

function applyCharacter(
  character: CharacterPluginState,
  mode: CharacterPluginMode,
  amount: number,
  tone: number,
  mix: number,
) {
  character.enabled = true;
  character.mode = mode;
  character.amount = clamp01(amount);
  character.tone = clamp01(tone);
  character.mix = clamp01(mix);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
