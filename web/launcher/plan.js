// MSW Launcher · 预制方案单一来源（R4，审查 §7.1）
// 一份带版本号的方案对象驱动：配置卡渲染摘要、开始前预检、单文件执行与批量执行。
// 方案从唯一真源构建（模块注册表 + 表单控件），不另立持久化，避免多份保存状态；
// 密钥只存在于连接配置，方案仅含服务引用参数。
(function () {
  "use strict";

  var PLAN_VERSION = 1;
  var POSTPROCESS_MODULE_IDS = ["match", "replace", "proofread", "resegment", "ocr", "translate"];

  function el(id) { return document.getElementById(id); }
  function t(key) { return window.MSWLauncher ? window.MSWLauncher.translate(key) : key; }

  function modules() { return window.MSWModules || null; }

  function isEnabled(id) {
    return modules() ? modules().isEnabled(id) !== false : true;
  }

  // 输入类型按扩展名判定：工程 / 字幕 / 媒体（与后端 run_prefab_plan 同一规则）。
  function inputKind(plan) {
    var path = String((plan && plan.input && plan.input.path) || "").trim();
    var lower = path.toLowerCase();
    if (lower.endsWith(".mosp") || lower.endsWith(".json")) return "project";
    if (lower.endsWith(".srt") || lower.endsWith(".ass")) return "srt";
    return path ? "media" : "";
  }

  function build() {
    var workflow = window.MSWWorkflow || null;
    var inputMode = workflow && workflow.inputMode ? workflow.inputMode() : "media";
    var inputPath = (el("mediaPath")?.value || "").trim();
    return {
      version: PLAN_VERSION,
      inputMode: inputMode,
      input: {
        path: inputPath,
        audioTrack: window.MSWLauncher?.getAudioTrackForMedia?.(inputPath) ?? null,
        defaultAudioTrack: window.MSWLauncher?.getDefaultAudioTrackForMedia?.(inputPath) ?? null,
        generateSpectral: Boolean(el("generateSpectral")?.checked),
      },
      modules: {
        waveform: isEnabled("waveform"),
        asr: isEnabled("asr"),
        postprocess: POSTPROCESS_MODULE_IDS.filter(isEnabled),
        alignment: isEnabled("alignment"),
      },
      // 后处理方案（步骤参数、输出模式、翻译目标）来自「转写后自动处理」的既有保存链。
      postprocess: window.MSWLauncher?.getAutoPostprocessPayload?.() || null,
      // T3/A1：有效输出配置——输出模块关闭时草稿不进方案（目录/主名清空=默认策略，
      // 导出开关回默认 true）；srtPath 是识别输出锚点（独立于输出模块）。
      output: (function () {
        var outputOn = modules() ? modules().isEnabled("output") !== false : false;
        return {
          srtPath: (el("srtPath")?.value || "").trim(),
          directory: outputOn ? (el("outputDirectory")?.value || "").trim() : "",
          projectName: outputOn ? (el("outputProjectName")?.value || "").trim() : "",
          exportSrt: outputOn ? (el("outputExportSrt") ? el("outputExportSrt").checked : true) : true,
          exportTranslatedSrt: outputOn ? (el("outputExportTranslatedSrt") ? el("outputExportTranslatedSrt").checked : true) : true,
        };
      })(),
    };
  }

  // §7.1 前端预检：输入类型、路径、模块依赖。返回 {ok:true} 或 {code, field, module?}。
  function preflight(plan) {
    var path = (plan.input && plan.input.path) || "";
    var postprocess = plan.modules.postprocess;
    if (plan.inputMode === "project") {
      if (!path) return { ok: false, code: "project_input_required", field: "mediaPath" };
      var kind = inputKind(plan);
      if (kind !== "project" && kind !== "srt") {
        return { ok: false, code: "project_input_unsupported", field: "mediaPath" };
      }
      if (!postprocess.length) {
        return { ok: false, code: "prefab_no_steps", field: "mediaPath" };
      }
      if (kind === "srt" && postprocess.indexOf("ocr") !== -1) {
        // OCR 需要视频画面；SRT 输入没有可回退的媒体（工程输入时媒体来自工程引用）。
        return { ok: false, code: "prefab_srt_needs_media", field: "mediaPath", module: "ocr" };
      }
      return { ok: true, alignmentPending: plan.modules.alignment };
    }
    if (!path) return { ok: false, code: "media_not_found", field: "mediaPath" };
    if (!plan.modules.asr && postprocess.length) {
      // 媒体工程没有字幕来源：定位后处理模块说明缺失条件，不静默跳过（F06）。
      return { ok: false, code: "prefab_needs_subtitles", field: "mediaPath", modules: postprocess.slice() };
    }
    return { ok: true, alignmentPending: plan.modules.alignment };
  }

  // 执行摘要标签：步骤顺序 = 媒体 → 波形 → 识别 → 后处理 → 翻译；对齐为独立人工入口。
  function summaryLabels(plan) {
    var labels = [];
    if (plan.inputMode === "project") {
      labels.push(inputKind(plan) === "srt" ? t("chip_input_srt") : t("chip_input_project"));
    } else {
      labels.push(t("chip_media"));
      if (plan.modules.waveform) labels.push(t("chip_waveform"));
      if (plan.modules.asr) labels.push(t("chip_asr"));
    }
    var cleanup = plan.modules.postprocess.filter(function (id) { return id !== "translate"; });
    if (cleanup.length) labels.push(t("chip_cleanup").replace("{n}", String(cleanup.length)));
    if (plan.modules.postprocess.indexOf("translate") !== -1) labels.push(t("chip_translate"));
    if (plan.modules.alignment) labels.push(t("chip_alignment_manual"));
    return labels;
  }

  window.MSWPlan = {
    version: PLAN_VERSION,
    build: build,
    preflight: preflight,
    inputKind: inputKind,
    summaryLabels: summaryLabels,
    POSTPROCESS_MODULE_IDS: POSTPROCESS_MODULE_IDS,
  };
})();
