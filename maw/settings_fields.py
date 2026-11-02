"""Field ownership metadata; defaults stay in their owning normalizers.

Included in the existing config registry for both server and portable clients.
"""
import copy
import math

EDITOR_KEY = 'moy.asr.editor.settings.v1'
WAVEFORM_KEY = 'moy.asr.waveform.settings.v1'
PROJECT_FIELDS = frozenset('subtitles segments preview timebase workspace speaker_palette audio_tracks audio_clips media assets gap_remove'.split())
EDITOR_FIELDS = {}

def _editor(keys, owner, *, workspace=False, exportable=True):
    for key in keys.split():
        EDITOR_FIELDS[key] = dict(owner=owner, workspace=workspace, exportable=exportable)

_editor('splitKey splitUseWordTimestamps splitTrimSymbols overlayEnabled extensionOverlayEnabled speakerAutoFollow cueListFollowPlayback cueListPairLayout cueListHideDisabled cueListCharcountThreshold cueEditorCancelOnEscape selectGroupMembers toolbarKbdHints cueEditorSplitMoreActions cueEditorSplitAutoClose ttsDraftClearOnSuccess ttsDraftSplitLines ttsDraftSplitMode ttsDraftSplitPunctuation ttsDraftSplitLimit mergeJoinTextContinuous mergeJoinTextWord autoSaveProject autoSaveIntervalSeconds stickerOverlayEnabled clickBehavior clickTarget pauseOnMouseClick keyboardOperationReference jklPlaybackMode mediaSeekStepMs mediaSeekStepFrames cueMoveStepMs cueMoveStepFrames timelineSnapToFrame timelineTimecodeSeparator hoverSeekPreview subtitleAvoidControls autoSnapAdjacentCues ninjaMode mergeTapeEffect ninjaSound ninjaSlashEffect ninjaSlashLengthPercent ninjaSlashRotateAmplitude crossTrackSnap selectBoundSubtitlePair multiSubtitleAutoSyncDuration theme waveShapeSource assetLibraryShowSearch themePreset accent colors', 'editor', workspace=False, exportable=True)
_editor('splitAutoSubmit mainSplitModeOverride assMode multiSubtitleRowHeight subtitleColorPaletteEnabled subtitleColorPalette', 'legacy', workspace=False, exportable=False)
_editor('flatTrackSettingsMigrated exportSpeakerLabelsExplicit', 'internal', workspace=False, exportable=False)
_editor('exportStartAtZero autoMergeGapMs autoMergeSnapDirection autoMergeShortCount autoMergeSnapGaps autoMergeStateMode autoMergeAbsorbShort autoMergeAbsorbDirection exportColorUnified exportSpeakerLabels exportSpeakerNamesAsSuffix stickerOtioExportMode otioExportIncludeSrt otioExportIncludeStickers otioExportIncludeMarkers', 'tool-default', workspace=False, exportable=True)
_editor('cueListShowIndex cueListShowTime cueListShowSticker cueListShowCharcount cueEditorShowNavigation cueEditorShowTimeActions cueEditorShowSticker', 'editor', workspace=True, exportable=True)

EDITOR_FIELDS['splitAutoSubmit']['retired'] = True
for _retired in ('cueListAutoScrollOnClick', 'cueListKeepSplitVisible'):
    EDITOR_FIELDS[_retired] = dict(owner='legacy', exportable=False, retired=True)
# Migrate only if the destination is absent; explicit modern values always win.
EDITOR_FIELDS['mergeJoinText'] = dict(owner='legacy', exportable=False, targets=['mergeJoinTextContinuous', 'mergeJoinTextWord'])
EDITOR_FIELDS['mediaSeekStepSeconds'] = dict(owner='legacy', exportable=False, targets=['mediaSeekStepMs'], scale=1000)
WAVEFORM_FIELDS = {key: dict(owner='editor', workspace=key not in ('spectralColor', 'layoutEditing'), exportable=key != 'layoutEditing') for key in
    'mode layout visibleSeconds secondsPerRow rowHeight side splitPercent layoutColumnPercent layoutRows layoutTree hiddenModules layoutEditing waveformScale waveformScaleAuto followSourceGain disabledDisplay showTrackHeads hoverDetails dragPlayhead spectralColor'.split()}
WAVEFORM_FIELDS['layoutEditing']['owner'] = 'session'
WAVEFORM_FIELDS['showGroupBadges'] = dict(owner='legacy', exportable=False, targets=['showTrackHeads'])
FIELDS = {EDITOR_KEY: EDITOR_FIELDS, WAVEFORM_KEY: WAVEFORM_FIELDS}


def validate_fields(sections, *, importing=False):
    for key, rules in FIELDS.items():
        values = sections.get('browser', {}).get(key)
        if not isinstance(values, dict):
            continue
        if PROJECT_FIELDS.intersection(values):
            raise ValueError('个人配置不能包含工程设置或字幕内容')
        if importing and set(values) - set(rules):
            raise ValueError('配置包含未登记的设置字段')


def migrate_sections(sections):
    result = copy.deepcopy(sections)
    browser = result.get('browser', {})
    for key, rules in FIELDS.items():
        values = browser.get(key)
        if not isinstance(values, dict):
            continue
        for field, rule in rules.items():
            if field not in values:
                continue
            if rule.get('retired'):
                values.pop(field)
                continue
            if not rule.get('targets'):
                continue
            value = values[field]
            if rule.get('scale'):
                if value is None or isinstance(value, bool):
                    continue
                try:
                    value = float(value) * rule['scale']
                except (ValueError, TypeError):
                    continue
                if not math.isfinite(value):
                    continue
                value = min(60000, max(10, math.floor(value + 0.5)))
            elif field == 'mergeJoinText' and not isinstance(value, str):
                continue
            elif field == 'showGroupBadges' and type(value) is not bool:
                continue
            for target in rule['targets']:
                values.setdefault(target, copy.deepcopy(value))
            values.pop(field)
    editor = browser.get(EDITOR_KEY, {})
    if (isinstance(editor, dict) and editor.get('flatTrackSettingsMigrated') is not True
            and editor.get('multiSubtitleRowHeight') in (64, 80, 96, 120, 144, 168, 192, 240, 300, 360)):
        wave = browser.setdefault(WAVEFORM_KEY, {})
        if isinstance(wave, dict):
            wave.setdefault('rowHeight', editor['multiSubtitleRowHeight'])
            editor['flatTrackSettingsMigrated'] = True
    return result


def export_value(key, value):
    if key not in FIELDS or not isinstance(value, dict):
        return value
    return {field: item for field, item in value.items() if FIELDS[key].get(field, {}).get('exportable') is True}
