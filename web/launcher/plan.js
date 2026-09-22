// One versioned plan for both a single task and a mixed queue.
(function () {
  "use strict";
  const POSTPROCESS_MODULE_IDS = ["match", "replace", "proofread", "resegment", "ocr", "translate"];
  const el = (id) => document.getElementById(id);
  const enabled = (id) => Boolean(window.MSWModules?.isEnabled(id));
  function build() {
    const outputOn = enabled("output");
    const tasks = window.MSWQueue?.tasks() || [];
    const recognition = window.MSWLauncher?.config ? window.MSWLauncher.getTranscriptionPayload() : {};
    // File identities and output paths belong to tasks, never to legacy projections.
    ['mediaPath', 'srtPath', 'audioTrack', 'defaultAudioTrack'].forEach(key => delete recognition[key]);
    return {
      version: 2, tasks,
      pendingAssociations: window.MSWQueue?.candidates().length || 0,
      modules: { waveform: enabled("waveform"), asr: enabled("asr"), postprocess: POSTPROCESS_MODULE_IDS.filter(enabled), alignment: enabled("alignment") },
      asrPolicy: el("queueAsrPolicy")?.value || "missing",
      rebuildWaveform: el("waveformCacheMode")?.value === "rebuild",
      generateSpectral: enabled("waveform") && Boolean(el("generateSpectral")?.checked),
      recognition,
      postprocess: window.MSWLauncher?.getAutoPostprocessPayload?.() || {},
      output: {
        srtPath: outputOn && tasks.length === 1 ? el("srtPath").value.trim() : "",
        directory: outputOn ? el("outputDirectory").value.trim() : "",
        projectName: outputOn ? el("outputProjectName").value.trim() : "",
        exportSrt: !outputOn || el("outputExportSrt").checked,
        exportTranslatedSrt: enabled('translate') && (!outputOn || el("outputExportTranslatedSrt").checked),
        exportBilingualSrt: outputOn && enabled('translate') && el('translationWriteMode').value === 'bilingual' && el('outputExportBilingualSrt').checked,
        srtOnly: outputOn && Boolean(el("batchSrtOnly")?.checked),
        generateHtml: outputOn && !el("batchSrtOnly").checked && el("generateHtml").checked,
      },
    };
  }
  function preflight(plan) {
    if (!plan.tasks.length) return { ok: false, module: "media", code: "queue_empty" };
    if (plan.pendingAssociations) return { ok: false, module: "media", code: "queue_confirm_pairs" };
    for (const task of plan.tasks) {
      const meta = window.MSWQueue?.state.files.find(file => file.id === task.id)?.meta;
      const subtitles = Boolean(task.subtitlePath || meta?.hasSubtitles);
      if (plan.output.srtOnly && !subtitles && !plan.modules.asr) return { ok: false, taskId: task.id, module: 'output', code: 'queue_srt_needs_text' };
      if (plan.modules.postprocess.length && !subtitles && !plan.modules.asr) return { ok: false, taskId: task.id, module: plan.modules.postprocess[0], code: "queue_needs_subtitles" };
      if (plan.modules.postprocess.includes('ocr') && !task.ocrVideoPath && !/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i.test(task.mediaPath) && !plan.postprocess.steps?.find(step => step.id === 'ocr')?.videoPath) return { ok: false, taskId: task.id, module: 'ocr', code: 'queue_needs_video' };
    }
    if (plan.output.srtOnly && !plan.output.exportSrt && !plan.output.exportTranslatedSrt && !plan.output.exportBilingualSrt) return { ok: false, module: 'output', code: 'queue_srt_choose_output' };
    return { ok: true };
  }
  function summaryLabels(plan) {
    const t = window.MSWLauncher.translate;
    return [t("queue_task_count").replace("{n}", plan.tasks.length), ...(plan.modules.waveform ? [t("chip_waveform")] : []), ...(plan.modules.asr ? [t("chip_asr")] : []), ...plan.modules.postprocess.map(id => t("mod_" + id))];
  }
  window.MSWPlan = { version: 2, build, preflight, summaryLabels, POSTPROCESS_MODULE_IDS };
})();
