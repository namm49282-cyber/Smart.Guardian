/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe } from 'lucide-react';
import { ArtifactConditionVerifierSection } from './components/ArtifactConditionVerifierSection';
import { CaptureStudio } from './components/CaptureStudio';
import { SpatialReconstructionViewport } from './components/SpatialReconstructionViewport';
import {
  TeamCreditsFooterBar,
  TeamCreditsModal,
} from './components/TeamCreditsModal';
import {
  HERO_SCANNER_IMAGE,
  INCENSE_ARTIFACT_IMAGES,
} from './data/culturalData';
import {
  getLocalizedDirections,
  PRESET_METADATA,
} from './i18n/domainTranslations';
import { SUPPORTED_LANGUAGES, UI_STRINGS } from './i18n/uiStrings';
import {
  ArtifactEnvironmentalProfile,
  ArtifactFormState,
  CaptureDirection,
  CapturedAngleImage,
  CulturalCorridorId,
  DocumentedArtifact,
  LocaleCode,
  MaterialConservationClass,
  PresetId,
  SurfaceMetrics,
} from './types/artifact';
import {
  createDefaultEnvironmentalProfile,
  createPresetEnvironmentalProfile,
  MATERIAL_CONSERVATION_PRESETS,
} from './utils/conservationEngine';
import {
  analyzeCanvasOrMediaFrame,
  computeMultiAngleMetrics,
  generateProceduralPresetAngles,
  loadImageElement,
} from './utils/imageAnalysis';

const STORAGE_KEY = 'smart_guardian_heritage_archive_v7';
const LOCALE_STORAGE_KEY = 'smart_guardian_locale_v2';

const EMPTY_METRICS: SurfaceMetrics = {
  totalAngles: 0,
  uniqueDirections: 0,
  angularCoveragePct: 0,
  meanSharpness: 0,
  illuminationConsistencyPct: 0,
  edgeReliefDensityPct: 0,
};

const PRESET_INVENTORY_WEIGHTS: Record<
  PresetId,
  { inv: string; weightGrams: string; countryCode: string }
> = {
  incense_burner: {
    inv: 'INV-2026-A101',
    weightGrams: '2450',
    countryCode: 'SA',
  },
  astrolabe: { inv: 'INV-2026-B204', weightGrams: '680', countryCode: 'ES' },
  silk_ewer: { inv: 'INV-2026-C309', weightGrams: '1320', countryCode: 'BH' },
};

function makeFormFromPreset(
  presetId: PresetId,
  locale: LocaleCode
): ArtifactFormState {
  const m = PRESET_METADATA[presetId][locale];
  const sep = locale === 'ar' ? '، ' : locale === 'zh' ? '、' : ', ';
  const extra = PRESET_INVENTORY_WEIGHTS[presetId];
  return {
    titleAr: m.title,
    inventoryNumber: extra.inv,
    periodAr: m.period,
    materialAr: m.material,
    dimensionsCm: m.dimensions,
    weightGrams: extra.weightGrams,
    conditionGrade: 'stable_excellent',
    countryCode: extra.countryCode,
    discoveryRegionAr: m.region,
    meetingCulturesText: m.cultures.join(sep),
    curatorialNotesAr: m.notes,
    teamNameAr: m.defaultTeam,
    environmental: createPresetEnvironmentalProfile(presetId, locale),
  };
}

function makeBlankRegistrationForm(locale: LocaleCode): ArtifactFormState {
  const defaultTeam = PRESET_METADATA.incense_burner[locale].defaultTeam;
  return {
    titleAr: '',
    inventoryNumber: '',
    periodAr: '',
    materialAr: '',
    dimensionsCm: '',
    weightGrams: '',
    conditionGrade: 'stable_excellent',
    countryCode: 'BH',
    discoveryRegionAr: '',
    meetingCulturesText: '',
    curatorialNotesAr: '',
    teamNameAr: defaultTeam,
    environmental: createDefaultEnvironmentalProfile(locale, 'stone_limestone'),
  };
}

export default function App() {
  const [locale, setLocale] = useState<LocaleCode>(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as LocaleCode | null;
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        return saved;
      }
    } catch {
      // Fallback to Arabic default
    }
    return 'ar';
  });

  const [activePresetKey, setActivePresetKey] = useState<PresetId | null>(
    'incense_burner'
  );
  const [isFormCustomized, setIsFormCustomized] = useState<boolean>(false);

  const [angles, setAngles] = useState<CapturedAngleImage[]>([]);
  const [metrics, setMetrics] = useState<SurfaceMetrics>(EMPTY_METRICS);
  const [isLoadingPreset, setIsLoadingPreset] = useState<boolean>(false);
  const [heroImgFailed, setHeroImgFailed] = useState<boolean>(false);

  const [formState, setFormState] = useState<ArtifactFormState>(() =>
    makeFormFromPreset('incense_burner', locale)
  );

  const [archive, setArchive] = useState<DocumentedArtifact[]>([]);
  const [isCreditsOpen, setIsCreditsOpen] = useState<boolean>(false);

  const t = UI_STRINGS[locale];
  const currentLangSpec =
    SUPPORTED_LANGUAGES.find((l) => l.code === locale) ?? SUPPORTED_LANGUAGES[0];
  const isRtl = currentLangSpec.dir === 'rtl';

  // Sync HTML document lang, dir (RTL/LTR), and runtime document title
  useEffect(() => {
    document.documentElement.lang = currentLangSpec.htmlLang;
    document.documentElement.dir = currentLangSpec.dir;
    document.title = t.pageTitle;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage error
    }
  }, [locale, currentLangSpec, t.pageTitle]);

  const handleSelectLocale = (nextLocale: LocaleCode) => {
    setLocale(nextLocale);
    if (activePresetKey && !isFormCustomized) {
      setFormState(makeFormFromPreset(activePresetKey, nextLocale));
    } else if (
      formState.teamNameAr === PRESET_METADATA.incense_burner[locale].defaultTeam
    ) {
      setFormState((prev) => ({
        ...prev,
        teamNameAr: PRESET_METADATA.incense_burner[nextLocale].defaultTeam,
      }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    computeMultiAngleMetrics(angles).then((computed) => {
      if (!cancelled) {
        setMetrics(computed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [angles]);

  const buildIncensePresetAngles = useCallback(async (): Promise<
    CapturedAngleImage[]
  > => {
    const dirs: CaptureDirection[] = [
      CaptureDirection.Front,
      CaptureDirection.Right,
      CaptureDirection.Back,
      CaptureDirection.Top,
    ];
    const specList = getLocalizedDirections('ar');
    const built: CapturedAngleImage[] = [];

    for (const dir of dirs) {
      const url = INCENSE_ARTIFACT_IMAGES[dir];
      const spec = specList.find((d) => d.id === dir) ?? specList[0];
      try {
        const img = await loadImageElement(url);
        const w = img.naturalWidth || 768;
        const h = img.naturalHeight || 768;
        const stats = analyzeCanvasOrMediaFrame(img, w, h);
        built.push({
          id: `incense-${dir}-${Math.random().toString(36).slice(2, 7)}`,
          direction: dir,
          labelAr: spec.label,
          azimuthDeg: spec.azimuthDeg,
          elevationDeg: spec.elevationDeg,
          dataUrl: url,
          source: 'preset',
          width: w,
          height: h,
          capturedAt: new Date().toISOString(),
          sharpnessScore: stats.sharpnessScore,
          brightnessPct: stats.brightnessPct,
        });
      } catch {
        const fallback = await generateProceduralPresetAngles('astrolabe');
        return fallback;
      }
    }
    return built;
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      setIsLoadingPreset(true);
      try {
        const incenseAngles = await buildIncensePresetAngles();
        if (!active) return;
        setAngles(incenseAngles);

        let stored: DocumentedArtifact[] = [];
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            stored = JSON.parse(raw);
          }
        } catch {
          stored = [];
        }

        if (stored.length > 0) {
          setArchive(stored);
        } else {
          const incenseMetrics = await computeMultiAngleMetrics(incenseAngles);
          const astrolabeAngles = await generateProceduralPresetAngles('astrolabe');
          const astrolabeMetrics = await computeMultiAngleMetrics(astrolabeAngles);
          const silkAngles = await generateProceduralPresetAngles('silk_ewer');
          const silkMetrics = await computeMultiAngleMetrics(silkAngles);

          const m1 = PRESET_METADATA.incense_burner.ar;
          const m2 = PRESET_METADATA.astrolabe.ar;
          const m3 = PRESET_METADATA.silk_ewer.ar;

          const seeded: DocumentedArtifact[] = [
            {
              id: 'seed-incense-01',
              accessionCode: 'SG-2026-001',
              inventoryNumber: 'INV-2026-A101',
              presetKey: 'incense_burner',
              titleAr: m1.title,
              periodAr: m1.period,
              materialAr: m1.material,
              dimensionsCm: m1.dimensions,
              weightGrams: '2450',
              conditionGrade: 'stable_excellent',
              countryCode: 'SA',
              discoveryRegionAr: m1.region,
              corridorId: m1.corridorId,
              meetingCulturesAr: m1.cultures,
              curatorialNotesAr: m1.notes,
              teamNameAr: m1.defaultTeam,
              createdAtIso: new Date().toISOString(),
              angles: incenseAngles,
              metrics: incenseMetrics,
              environmentalProfile: createPresetEnvironmentalProfile(
                'incense_burner',
                'ar'
              ),
            },
            {
              id: 'seed-astrolabe-02',
              accessionCode: 'SG-2026-002',
              inventoryNumber: 'INV-2026-B204',
              presetKey: 'astrolabe',
              titleAr: m2.title,
              periodAr: m2.period,
              materialAr: m2.material,
              dimensionsCm: m2.dimensions,
              weightGrams: '680',
              conditionGrade: 'stable_excellent',
              countryCode: 'ES',
              discoveryRegionAr: m2.region,
              corridorId: m2.corridorId,
              meetingCulturesAr: m2.cultures,
              curatorialNotesAr: m2.notes,
              teamNameAr: m2.defaultTeam,
              createdAtIso: new Date().toISOString(),
              angles: astrolabeAngles,
              metrics: astrolabeMetrics,
              environmentalProfile: createPresetEnvironmentalProfile(
                'astrolabe',
                'ar'
              ),
            },
            {
              id: 'seed-silk-03',
              accessionCode: 'SG-2026-003',
              inventoryNumber: 'INV-2026-C309',
              presetKey: 'silk_ewer',
              titleAr: m3.title,
              periodAr: m3.period,
              materialAr: m3.material,
              dimensionsCm: m3.dimensions,
              weightGrams: '1320',
              conditionGrade: 'stable_excellent',
              countryCode: 'BH',
              discoveryRegionAr: m3.region,
              corridorId: m3.corridorId,
              meetingCulturesAr: m3.cultures,
              curatorialNotesAr: m3.notes,
              teamNameAr: m3.defaultTeam,
              createdAtIso: new Date().toISOString(),
              angles: silkAngles,
              metrics: silkMetrics,
              environmentalProfile: createPresetEnvironmentalProfile(
                'silk_ewer',
                'ar'
              ),
            },
          ];
          if (active) {
            setArchive(seeded);
          }
        }
      } finally {
        if (active) {
          setIsLoadingPreset(false);
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [buildIncensePresetAngles]);

  const handleLoadPreset = async (presetId: PresetId) => {
    setIsLoadingPreset(true);
    try {
      const list =
        presetId === 'incense_burner'
          ? await buildIncensePresetAngles()
          : await generateProceduralPresetAngles(presetId);

      setAngles(list);
      setActivePresetKey(presetId);
      setIsFormCustomized(false);
      setFormState(makeFormFromPreset(presetId, locale));
    } finally {
      setIsLoadingPreset(false);
    }
  };

  const handleAddAngle = (newAngle: CapturedAngleImage) => {
    setAngles((prev) => [...prev, newAngle]);
  };

  const handleAddMultipleAngles = (newAngles: CapturedAngleImage[]) => {
    setAngles((prev) => [...prev, ...newAngles]);
  };

  const handleUpdateDirection = (id: string, direction: CaptureDirection) => {
    const specList = getLocalizedDirections(locale);
    const spec = specList.find((d) => d.id === direction) ?? specList[0];
    setAngles((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              direction: spec.id,
              labelAr: spec.label,
              azimuthDeg: spec.azimuthDeg,
              elevationDeg: spec.elevationDeg,
            }
          : a
      )
    );
  };

  const handleRemoveAngle = (id: string) => {
    setAngles((prev) => prev.filter((a) => a.id !== id));
  };

  const handleClearAll = () => {
    setAngles([]);
    setActivePresetKey(null);
    setIsFormCustomized(true);
    setFormState(makeBlankRegistrationForm(locale));
  };

  const handleResetOnlyForm = () => {
    setActivePresetKey(null);
    setIsFormCustomized(true);
    setFormState(makeBlankRegistrationForm(locale));
  };

  const handleApplyMaterialPreset = (matClass: MaterialConservationClass) => {
    setIsFormCustomized(true);
    const spec = MATERIAL_CONSERVATION_PRESETS[matClass];
    const midTemp = Number(
      ((spec.tempSafeMinC + spec.tempSafeMaxC) / 2).toFixed(1)
    );
    const midRh = Math.round((spec.rhSafeMinPct + spec.rhSafeMaxPct) / 2);

    setFormState((prev) => ({
      ...prev,
      environmental: {
        ...prev.environmental,
        materialClass: matClass,
        tempSafeMinC: spec.tempSafeMinC,
        tempSafeMaxC: spec.tempSafeMaxC,
        tempCurrentC: midTemp,
        rhSafeMinPct: spec.rhSafeMinPct,
        rhSafeMaxPct: spec.rhSafeMaxPct,
        rhCurrentPct: midRh,
      },
    }));
  };

  const handleSaveArtifact = (): DocumentedArtifact | null => {
    if (angles.length < 3) return null;
    const nextCode = `SG-2026-${String(archive.length + 1).padStart(3, '0')}`;
    const record: DocumentedArtifact = {
      id: `doc-${Date.now()}`,
      accessionCode: nextCode,
      inventoryNumber:
        formState.inventoryNumber.trim() ||
        `INV-2026-${String(archive.length + 1).padStart(3, '0')}`,
      presetKey: isFormCustomized ? undefined : activePresetKey ?? undefined,
      titleAr: formState.titleAr.trim() || t.fieldArtifactName,
      periodAr: formState.periodAr.trim() || t.fieldPeriod,
      materialAr: formState.materialAr.trim() || t.fieldMaterial,
      dimensionsCm: formState.dimensionsCm.trim() || '20 × 20 cm',
      weightGrams: formState.weightGrams.trim() || '1200',
      conditionGrade: formState.conditionGrade,
      countryCode: formState.countryCode || 'BH',
      discoveryRegionAr: formState.discoveryRegionAr.trim() || t.fieldRegion,
      corridorId: CulturalCorridorId.IncenseRoute,
      meetingCulturesAr: formState.meetingCulturesText
        .split(/[،,、]/)
        .map((s) => s.trim())
        .filter(Boolean),
      curatorialNotesAr: formState.curatorialNotesAr.trim(),
      teamNameAr:
        formState.teamNameAr.trim() ||
        PRESET_METADATA.incense_burner[locale].defaultTeam,
      createdAtIso: new Date().toISOString(),
      angles,
      metrics,
      environmentalProfile: formState.environmental,
    };

    const updated = [record, ...archive];
    setArchive(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 8)));
    } catch {
      // Ignore storage quota overflow safely
    }
    return record;
  };

  const handleLoadArchivedArtifact = (item: DocumentedArtifact) => {
    setAngles(item.angles);
    if (item.presetKey) {
      setActivePresetKey(item.presetKey);
      setIsFormCustomized(false);
      const basePresetForm = makeFormFromPreset(item.presetKey, locale);
      setFormState({
        ...basePresetForm,
        countryCode: item.countryCode || basePresetForm.countryCode,
        environmental:
          item.environmentalProfile ?? basePresetForm.environmental,
      });
    } else {
      setActivePresetKey(null);
      setIsFormCustomized(true);
      const sep = locale === 'ar' ? '، ' : locale === 'zh' ? '、' : ', ';
      setFormState({
        titleAr: item.titleAr,
        inventoryNumber: item.inventoryNumber ?? '',
        periodAr: item.periodAr,
        materialAr: item.materialAr,
        dimensionsCm: item.dimensionsCm,
        weightGrams: item.weightGrams ?? '',
        conditionGrade: item.conditionGrade ?? 'stable_excellent',
        countryCode: item.countryCode || 'BH',
        discoveryRegionAr: item.discoveryRegionAr,
        meetingCulturesText: item.meetingCulturesAr.join(sep),
        curatorialNotesAr: item.curatorialNotesAr,
        teamNameAr: item.teamNameAr,
        environmental:
          item.environmentalProfile ??
          createDefaultEnvironmentalProfile(locale, 'stone_limestone'),
      });
    }
  };

  const workflowSteps = [
    {
      num: '01',
      href: '#capture-studio',
      label: t.step1Label,
      title: t.step1Title,
      desc: t.step1Desc,
      liveStatus: t.stepLiveAnglesStatus(angles.length),
      isReady: angles.length >= 3,
    },
    {
      num: '02',
      href: '#spatial-studio',
      label: t.step2Label,
      title: t.step2Title,
      desc: t.step2Desc,
      liveStatus: t.stepLiveCoverageStatus(metrics.angularCoveragePct),
      isReady: angles.length >= 3,
    },
    {
      num: '03',
      href: '#artifact-registration',
      label: t.step3Label,
      title: t.step3Title,
      desc: t.step3Desc,
      liveStatus: `${formState.environmental.tempSafeMinC}–${formState.environmental.tempSafeMaxC}°C · ${formState.environmental.rhSafeMinPct}–${formState.environmental.rhSafeMaxPct}%`,
      isReady: true,
    },
    {
      num: '04',
      href: '#condition-verification',
      label: t.step4Label,
      title: t.step4Title,
      desc: t.step4Desc,
      liveStatus: t.stepLiveArchiveStatus(archive.length),
      isReady: archive.length > 0,
    },
  ];

  const StepArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      dir={currentLangSpec.dir}
      className="min-h-screen flex flex-col bg-[#FBF9F5] text-[#1C1814]"
    >
      {/* Strict 3-Zone Top Navigation Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#FBF9F5]/95 backdrop-blur-xs border-b border-[#DED4C3] px-6 py-3.5">
        <div className="max-w-[1160px] mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#"
            className="font-editorial text-2xl sm:text-[1.7rem] font-bold text-[#1C1814] hover:text-[#0F4C45] transition-colors whitespace-nowrap shrink-0"
          >
            {t.brandName}
          </a>

          {/* Zone 2: 4 concise single-line text navigation links */}
          <nav
            aria-label={t.brandName}
            className="hidden lg:flex items-center gap-7 text-sm font-semibold text-[#4A423A]"
          >
            <a
              href="#capture-studio"
              className="hover:text-[#0F4C45] hover:underline decoration-[#9E6E24] decoration-2 underline-offset-8 transition-colors whitespace-nowrap shrink-0"
            >
              {t.navCapture}
            </a>
            <a
              href="#spatial-studio"
              className="hover:text-[#0F4C45] hover:underline decoration-[#9E6E24] decoration-2 underline-offset-8 transition-colors whitespace-nowrap shrink-0"
            >
              {t.navSpatial}
            </a>
            <a
              href="#artifact-registration"
              className="hover:text-[#0F4C45] hover:underline decoration-[#9E6E24] decoration-2 underline-offset-8 transition-colors whitespace-nowrap shrink-0"
            >
              {t.navCultures}
            </a>
            <a
              href="#condition-verification"
              className="hover:text-[#0F4C45] hover:underline decoration-[#9E6E24] decoration-2 underline-offset-8 transition-colors whitespace-nowrap shrink-0"
            >
              {t.navArchive}
            </a>
          </nav>

          {/* Zone 3: 1 primary action — jumps directly to New Artifact Registration & Environmental Form */}
          <div className="flex items-center shrink-0">
            <a
              href="#artifact-registration"
              onClick={() => handleResetOnlyForm()}
              className="btn-guardian-primary px-5 py-2 text-xs"
            >
              {t.ctaNewArtifact}
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Smart Guardian Simplified Hero & 4-Step Summary */}
        <section className="py-9 lg:py-14 border-b border-[#DED4C3] bg-[#FBF9F5]">
          <div className="max-w-[1160px] mx-auto px-6">
            {/* International 5-Language Switcher Toolbar */}
            <div className="mb-8 pb-4 border-b border-[#E5DDD0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#5C5247]">
                <Globe className="w-4 h-4 text-[#9E6E24] shrink-0" />
                <span>{t.editionLanguageLabel}</span>
              </div>

              <div
                role="group"
                aria-label={t.editionLanguageLabel}
                className="segmented-track"
              >
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isActive = locale === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleSelectLocale(lang.code)}
                      aria-pressed={isActive}
                      className={`segmented-tab px-3.5 py-1.5 text-xs ${
                        isActive ? 'segmented-tab-active' : 'segmented-tab-idle'
                      }`}
                    >
                      {lang.nativeLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-9 items-stretch">
              {/* Primary Editorial Column (6 cols) */}
              <div className="lg:col-span-6 flex flex-col justify-between py-1">
                <div>
                  <div className="text-xs font-medium text-[#6E6357] mb-3 flex items-center gap-2 flex-wrap">
                    <span>{t.heroKicker1}</span>
                    <span aria-hidden="true" className="text-[#9E6E24]">·</span>
                    <span>{t.heroKicker2}</span>
                    <span aria-hidden="true" className="text-[#9E6E24]">·</span>
                    <span>{t.heroKicker3}</span>
                  </div>

                  <p className="text-sm font-bold text-[#0F4C45] mb-2.5">
                    {t.heroBrandLockup}
                  </p>

                  <h1
                    className="font-display-heritage font-bold text-[#1C1814] mb-4 balance-text"
                    style={{ fontSize: 'clamp(2.2rem, 3.5vw, 3.35rem)' }}
                  >
                    {t.heroTitle}
                  </h1>

                  <p className="text-base text-[#4A423A] leading-relaxed max-w-[60ch] mb-7">
                    {t.heroLead}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3.5 pt-2">
                  <a
                    href="#capture-studio"
                    className="btn-guardian-primary px-6 py-3 text-sm"
                  >
                    {t.heroPrimaryBtn}
                  </a>
                  <a
                    href="#condition-verification"
                    className="btn-guardian-secondary px-6 py-3 text-sm"
                  >
                    {t.heroSecondaryBtn}
                  </a>
                </div>
              </div>

              {/* Hero Media Column (6 cols) */}
              <div className="lg:col-span-6">
                <figure className="h-full flex flex-col">
                  <div className="relative flex-1 min-h-[270px] lg:min-h-[345px] rounded-2xl overflow-hidden border border-[#D4C7B0] bg-[#EAE1D0] shadow-[0_6px_24px_rgba(28,24,20,0.08)]">
                    {!heroImgFailed ? (
                      <img
                        src={HERO_SCANNER_IMAGE}
                        alt={t.heroFigCaption}
                        referrerPolicy="no-referrer"
                        onError={() => setHeroImgFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#F3EDE1] to-[#DED3BE]">
                        <span className="font-editorial text-2xl font-bold text-[#1C1814] mb-2">
                          {t.heroFallbackTitle}
                        </span>
                        <span className="text-xs text-[#6E6357]">
                          {t.heroFallbackSub}
                        </span>
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5">
                      <p className="text-xs font-medium text-[#FBF9F5]">
                        {t.heroScrimCaption}
                      </p>
                    </div>
                  </div>
                </figure>
              </div>
            </div>

            {/* 4 Harmonized Curatorial Stages Culminating in Step 04 */}
            <div className="mt-12 pt-9 border-t border-[#DED4C3]">
              <div className="mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-[#1C1814] balance-text">
                  {t.workflowSectionTitle}
                </h2>
                <p className="text-sm text-[#6E6357] mt-1 max-w-2xl">
                  {t.workflowSectionSub}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {workflowSteps.map((step, index) => {
                  const isFinale = index === 3;
                  return (
                    <a
                      key={step.num}
                      href={step.href}
                      className={`group rounded-2xl p-5 flex flex-col justify-between border transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F4C45] ${
                        isFinale
                          ? 'bg-[#F5EFE2] border-[#C89E54] hover:border-[#0F4C45]'
                          : 'card-guardian hover:border-[#0F4C45]/60'
                      }`}
                    >
                      <div>
                        <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-[#E5DDD0]">
                          <div className="flex items-baseline gap-2">
                            <span
                              className={`font-mono text-2xl font-bold tabular-nums leading-none ${
                                isFinale ? 'text-[#0F4C45]' : 'text-[#9E6E24]'
                              }`}
                            >
                              {step.num}
                            </span>
                            <span className="text-[11px] font-semibold text-[#6E6357]">
                              {step.label}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-mono tabular-nums ${
                              step.isReady
                                ? 'text-[#0F4C45] font-semibold'
                                : 'text-[#92400E] font-medium'
                            }`}
                          >
                            {step.liveStatus}
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-[#1C1814] mt-3.5 leading-snug">
                          {step.title}
                        </h3>

                        <p className="text-xs text-[#5C5247] mt-1.5 leading-relaxed">
                          {step.desc}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#E5DDD0] flex items-center justify-between gap-2 text-xs font-bold text-[#0F4C45] group-hover:text-[#9E6E24] transition-colors">
                        <span>{t.stepGoAction}</span>
                        <StepArrowIcon className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 01. Multi-Angle Live Capture & Upload Studio */}
        <CaptureStudio
          locale={locale}
          angles={angles}
          onAddAngle={handleAddAngle}
          onAddMultipleAngles={handleAddMultipleAngles}
          onUpdateDirection={handleUpdateDirection}
          onRemoveAngle={handleRemoveAngle}
          onClearAll={handleClearAll}
          onLoadPreset={handleLoadPreset}
          isLoadingPreset={isLoadingPreset}
          onJumpTo3D={() => {
            document
              .getElementById('spatial-studio')
              ?.scrollIntoView({ behavior: 'smooth' });
          }}
        />

        {/* 02. Three.js Spatial Reconstruction & Relief Studio */}
        <SpatialReconstructionViewport
          locale={locale}
          angles={angles}
          metrics={metrics}
        />

        {/* 03 & 04. Essential Artifact Registration (with World Country Dropdown) + Condition Verification, Comparison & Red-Risk Urgent Recommendations */}
        <ArtifactConditionVerifierSection
          locale={locale}
          angles={angles}
          metrics={metrics}
          formState={formState}
          onChangeBasicField={(field, value) => {
            setIsFormCustomized(true);
            setFormState((prev) => ({ ...prev, [field]: value }));
          }}
          onChangeEnvField={(
            field: keyof ArtifactEnvironmentalProfile,
            value
          ) => {
            setIsFormCustomized(true);
            setFormState((prev) => ({
              ...prev,
              environmental: {
                ...prev.environmental,
                [field]: value,
              },
            }));
          }}
          onApplyMaterialPreset={handleApplyMaterialPreset}
          onSaveArtifact={handleSaveArtifact}
          onResetNewArtifactForm={handleResetOnlyForm}
          onJumpToCapture={() => {
            document
              .getElementById('capture-studio')
              ?.scrollIntoView({ behavior: 'smooth' });
          }}
          registeredArtifacts={archive}
          onLoadRegisteredArtifactTo3D={handleLoadArchivedArtifact}
        />
      </main>

      {/* Curatorial Footer with Prominent Localized "Design & Programming" Icon Card */}
      <footer className="bg-[#FBF9F5] border-t border-[#DED4C3] py-9 px-6">
        <div className="max-w-[1160px] mx-auto flex flex-col gap-6">
          <TeamCreditsFooterBar
            locale={locale}
            onOpen={() => setIsCreditsOpen(true)}
          />

          <div className="pt-4 border-t border-[#E5DDD0] flex flex-col lg:flex-row items-center justify-between gap-4 text-xs text-[#6E6357]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-editorial text-lg font-bold text-[#1C1814]">
                {t.brandName}
              </span>
              <span aria-hidden="true" className="text-[#9E6E24]">·</span>
              <span>{t.footerTagline}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={`footer-${lang.code}`}
                  type="button"
                  onClick={() => handleSelectLocale(lang.code)}
                  className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    locale === lang.code
                      ? 'font-bold text-[#0F4C45] underline decoration-[#9E6E24] decoration-2 underline-offset-4'
                      : 'text-[#6E6357] hover:text-[#1C1814]'
                  }`}
                >
                  {lang.nativeLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>

      <TeamCreditsModal
        locale={locale}
        isOpen={isCreditsOpen}
        onClose={() => setIsCreditsOpen(false)}
      />
    </div>
  );
}
