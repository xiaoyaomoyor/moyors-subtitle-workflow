"""Qwen non-realtime capability catalog, checked against official docs 2026-09-09.

https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
Only factual IDs, names and model compatibility are copied; no voice samples.
"""

MODEL_TYPES = {
    "CustomVoice": ["qwen3-tts-flash", "qwen3-tts-flash-2025-11-27", "qwen3-tts-flash-2025-09-18",
                    "qwen3-tts-instruct-flash", "qwen3-tts-instruct-flash-2026-01-26"],
    "VoiceDesign": ["qwen3-tts-vd-2026-01-26"],
    "VoiceClone": ["qwen3-tts-vc-2026-01-22"],
}
MODELS = [model for models in MODEL_TYPES.values() for model in models]

# The Instruct catalog excludes dialect and several international voices.
INSTRUCT_VOICES = set("Cherry Serena Ethan Chelsie Momo Vivian Moon Maia Kai Nofish Bella Mia Mochi Bellona Vincent Bunny Neil Elias Arthur Nini Seren Pip Stella".split()) | {"Eldric Sage"}
EARLY_VOICES = set("Cherry Ethan Nofish Jennifer Ryan Katerina Elias Jada Dylan Li Marcus Roy Peter Sunny Eric Rocky Kiki".split())

_VOICES = [
    ("Cherry", "芊悦", "女声", "普通话"), ("Serena", "苏瑶", "女声", "普通话"),
    ("Ethan", "晨煦", "男声", "普通话"), ("Chelsie", "千雪", "女声", "普通话"),
    ("Momo", "茉兔", "女声", "普通话"), ("Vivian", "十三", "女声", "普通话"),
    ("Moon", "月白", "男声", "普通话"), ("Maia", "四月", "女声", "普通话"),
    ("Kai", "凯", "男声", "普通话"), ("Nofish", "不吃鱼", "男声", "普通话"),
    ("Bella", "萌宝", "女声", "普通话"), ("Jennifer", "詹妮弗", "女声", "多语音色"),
    ("Ryan", "甜茶", "男声", "多语音色"), ("Katerina", "卡捷琳娜", "女声", "多语音色"),
    ("Aiden", "艾登", "男声", "多语音色"), ("Eldric Sage", "沧明子", "男声", "角色音色"),
    ("Mia", "乖小妹", "女声", "角色音色"), ("Mochi", "沙小弥", "男声", "角色音色"),
    ("Bellona", "燕铮莺", "女声", "角色音色"), ("Vincent", "田叔", "男声", "角色音色"),
    ("Bunny", "萌小姬", "女声", "角色音色"), ("Neil", "阿闻", "男声", "角色音色"),
    ("Elias", "墨讲师", "女声", "角色音色"), ("Arthur", "徐大爷", "男声", "角色音色"),
    ("Nini", "邻家妹妹", "女声", "角色音色"), ("Seren", "小婉", "女声", "角色音色"),
    ("Pip", "顽屁小孩", "男声", "角色音色"), ("Stella", "少女阿月", "女声", "角色音色"),
    ("Bodega", "博德加", "男声", "多语音色"), ("Sonrisa", "索尼莎", "女声", "多语音色"),
    ("Alek", "阿列克", "男声", "多语音色"), ("Dolce", "多尔切", "男声", "多语音色"),
    ("Sohee", "素熙", "女声", "多语音色"), ("Ono Anna", "小野杏", "女声", "多语音色"),
    ("Lenn", "莱恩", "男声", "多语音色"), ("Emilien", "埃米尔安", "男声", "多语音色"),
    ("Andre", "安德雷", "男声", "多语音色"), ("Radio Gol", "拉迪奥·戈尔", "男声", "多语音色"),
    ("Jada", "上海·阿珍", "女声", "方言"), ("Dylan", "北京·晓东", "男声", "方言"),
    ("Li", "南京·老李", "男声", "方言"), ("Marcus", "陕西·秦川", "男声", "方言"),
    ("Roy", "闽南·阿杰", "男声", "方言"), ("Peter", "天津·李彼得", "男声", "方言"),
    ("Sunny", "四川·晴儿", "女声", "方言"), ("Eric", "四川·程川", "男声", "方言"),
    ("Rocky", "粤语·阿强", "男声", "方言"), ("Kiki", "粤语·阿清", "女声", "方言"),
]


# Official demo URLs only; audio is streamed on explicit audition.
_PREVIEWS = {
    "Cherry": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/tixcef/cherry.wav",
    "Serena": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/bxokea/serena.wav",
    "Ethan": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/emaqdp/ethan.wav",
    "Chelsie": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/vnpxgw/chelsie.wav",
    "Momo": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/rvzrcx/Momo.wav",
    "Vivian": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/eetwkj/Vivian.wav",
    "Moon": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/bcaqju/Moon.wav",
    "Maia": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/fewawx/Maia.wav",
    "Kai": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/maiqbf/Kai.wav",
    "Nofish": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/xurcmx/Nofish.wav",
    "Bella": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/optibu/Bella.wav",
    "Jennifer": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/fejjiv/Jennifer.wav",
    "Ryan": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/wsytum/Ryan.wav",
    "Katerina": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/fschpb/Katerina.wav",
    "Aiden": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/hgxtqi/Aiden.wav",
    "Eldric Sage": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/hbvhwj/Eldric+Sage.wav",
    "Mia": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/gpvlix/Mia.wav",
    "Mochi": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/zapcpe/Mochi.wav",
    "Bellona": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/wztwli/Bellona.wav",
    "Vincent": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/skfrkq/Vincent.wav",
    "Bunny": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/aswewm/Bunny.wav",
    "Neil": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/ucmfkt/Neil.wav",
    "Elias": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/rhbvqx/Elias.wav",
    "Arthur": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/ynqwyu/Arthur.wav",
    "Nini": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/lppeba/Nini.wav",
    "Seren": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/xlksoe/Seren.wav",
    "Pip": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/gqxoub/Pip.wav",
    "Stella": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/azikxr/Stella.wav",
    "Bodega": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/jxnuap/Bodega.wav",
    "Sonrisa": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/uywoxb/Sonrisa.wav",
    "Alek": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/wtklus/Alek.wav",
    "Dolce": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/pirhim/Dolce.wav",
    "Sohee": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/wwphft/Sohee.wav",
    "Ono Anna": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/mvfbxy/Ono+Anna.wav",
    "Lenn": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/arnzdt/Lenn.wav",
    "Emilien": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/qltlde/Emilien.wav",
    "Andre": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/hhfogy/Andre.wav",
    "Radio Gol": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251120/vnezxq/Radio+Gol.wav",
    "Jada": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/qjfmmi/Jada.wav",
    "Dylan": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/ultaxm/Dylan.wav",
    "Li": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250916/frgdes/Li.wav",
    "Marcus": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/dwnnrg/Marcus.wav",
    "Roy": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/stsfsz/Roy.wav",
    "Peter": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/twvnsp/Peter.wav",
    "Sunny": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/jtrktt/Sunny.wav",
    "Eric": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/qhbznw/Eric.wav",
    "Rocky": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/kfxxgp/Rocky.wav",
    "Kiki": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250910/qwinef/KiKi.wav"
}


def model_type(model):
    return next((kind for kind, models in MODEL_TYPES.items() if model in models), None)


def voices_for(model):
    if model_type(model) != "CustomVoice":
        return []
    allowed = INSTRUCT_VOICES if "-instruct-" in model else EARLY_VOICES if model.endswith("2025-09-18") else None
    return [{"id": voice, "name": name, "gender": gender, "group": group, "preview_url": _PREVIEWS.get(voice, "")} for voice, name, gender, group in _VOICES
            if allowed is None or voice in allowed]


def catalog_payload():
    return {"modelTypes": MODEL_TYPES, "systemVoices": {model: voices_for(model) for model in MODEL_TYPES["CustomVoice"]}}
